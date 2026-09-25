import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
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
    response
      .status(status)
      .json({
        error: {
          code: status === 404 ? 'NOT_FOUND' : 'REQUEST_FAILED',
          message: status === 404 ? 'Resource not found' : 'Request failed',
          details: {},
        },
        trace_id: randomBytes(16).toString('hex'),
      });
  }
}

export async function createService(service: string) {
  @Controller()
  class FoundationController {
    @Get('/health/live')
    live() {
      return { status: 'live', service, stage: 'scaffold' };
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
        trace_id: randomBytes(16).toString('hex'),
      };
    }
  }
  @Module({ controllers: [FoundationController] })
  class FoundationModule {}
  const app = await NestFactory.create(FoundationModule, { logger: ['error', 'warn', 'log'] });
  app.enableShutdownHooks();
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
  const app = await createService(service);
  await app.listen(config.port, config.host);
  return app;
}
