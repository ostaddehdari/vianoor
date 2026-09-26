import 'reflect-metadata';
import { currentTraceId, newTrace, traceContext } from './trace.js';
import { connectInfrastructure } from './infrastructure.js';
export * from './messaging.js';
export * from './trace.js';
export * from './infrastructure.js';
import {
  Controller,
  Get,
  Module,
  HttpException,
  HttpStatus,
  Catch,
  type ExceptionFilter,
  type ArgumentsHost,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { readRuntimeConfig } from './config.js';
export { readRuntimeConfig } from './config.js';

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
}
@Catch()
class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const response = host.switchToHttp().getResponse<ResponseLike>();
    // No raw exception, request body, provider key or stack is sent to clients.
    response.status(status).json({
      error: {
        code: status === 404 ? 'NOT_FOUND' : 'REQUEST_FAILED',
        message: status === 404 ? 'Resource not found' : 'Request failed',
        details: {},
      },
      trace_id: currentTraceId(),
    });
  }
}

export async function createService(
  service: string,
  options: {
    infrastructure?: { healthy(): Promise<boolean>; close(): Promise<void> };
    gatewayTarget?: string;
  } = {},
) {
  @Controller()
  class FoundationController {
    @Get('/health/live')
    live() {
      return { status: 'live', service, stage: 'scaffold' };
    }

    @Get('/health/infra')
    async infrastructure() {
      const healthy = (await options.infrastructure?.healthy()) ?? false;
      if (!healthy)
        throw new HttpException({ status: 'not_ready', service, stage: 'infrastructure' }, 503);
      return { status: 'ready', service, stage: 'infrastructure' };
    }

    @Get('/health/ready')
    ready() {
      throw new HttpException(
        { status: 'not_ready', service, stage: 'scaffold' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    @Get('/api/v1')
    info() {
      return {
        data: { service, stage: 'scaffold' },
        meta: {},
        trace_id: currentTraceId(),
      };
    }
  }
  @Module({ controllers: [FoundationController] })
  class FoundationModule {}
  const app = await NestFactory.create(FoundationModule, { logger: ['error', 'warn', 'log'] });
  app.enableShutdownHooks();
  app.use(
    (
      req: { headers: Record<string, unknown>; method: string; path: string },
      res: {
        setHeader(k: string, v: string): void;
        on(event: string, fn: () => void): void;
        statusCode: number;
      },
      next: () => void,
    ) => {
      const context = newTrace(req.headers.traceparent);
      res.setHeader('x-trace-id', context.traceId);
      res.setHeader('traceparent', context.traceparent);
      const started = performance.now();
      res.on('finish', () =>
        console.log(
          JSON.stringify({
            service,
            trace_id: context.traceId,
            method: req.method,
            status: res.statusCode,
            duration_ms: Math.round(performance.now() - started),
          }),
        ),
      );
      traceContext.run(context, next);
    },
  );
  if (service === 'api-gateway' && options.gatewayTarget) {
    // Explicit metadata-only route; no arbitrary upstream URL or domain endpoints before auth.
    const target = new URL('/api/v1', options.gatewayTarget).href;
    app.use(
      '/api/v1/services/identity',
      async (
        req: { method: string; url: string },
        res: { status(n: number): typeof res; json(body: unknown): void },
        next: () => void,
      ) => {
        if (req.method !== 'GET' || req.url !== '/') return next();
        try {
          const response = await fetch(target, {
            headers: { traceparent: traceContext.getStore()!.traceparent },
            signal: AbortSignal.timeout(2500),
            redirect: 'error',
          });
          res.status(response.status).json(await response.json());
        } catch {
          res
            .status(502)
            .json({
              error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Upstream unavailable', details: {} },
              trace_id: currentTraceId(),
            });
        }
      },
    );
  }
  if (options.infrastructure) {
    const close = app.close.bind(app);
    app.close = async () => {
      await options.infrastructure!.close();
      await close();
    };
    // Nest's signal handler invokes dispose; use an injectable lifecycle hook as well.
    const server = app.getHttpServer();
    server.once('close', () => {
      void options.infrastructure!.close();
    });
  }
  // Explicit health exception handling keeps readiness distinct from API errors.
  @Catch(HttpException)
  class HealthAndHttpFilter extends SafeExceptionFilter {
    override catch(exception: HttpException, host: ArgumentsHost) {
      const body = exception.getResponse();
      if (
        exception.getStatus() === 503 &&
        typeof body === 'object' &&
        'status' in body &&
        body.status === 'not_ready'
      ) {
        host.switchToHttp().getResponse<ResponseLike>().status(503).json(body);
        return;
      }
      super.catch(exception, host);
    }
  }
  app.useGlobalFilters(new SafeExceptionFilter(), new HealthAndHttpFilter());
  return app;
}

export async function bootstrap(service: string, defaultPort: number) {
  const config = readRuntimeConfig(defaultPort);
  const infrastructure =
    process.env.INFRA_ENABLED === '1' ? await connectInfrastructure(service) : undefined;
  const app = await createService(service, {
    ...(infrastructure ? { infrastructure } : {}),
    ...(service === 'api-gateway' && infrastructure
      ? { gatewayTarget: process.env.IDENTITY_URL ?? 'http://identity-service:4101' }
      : {}),
  });
  await app.listen(config.port, config.host);
  return app;
}
