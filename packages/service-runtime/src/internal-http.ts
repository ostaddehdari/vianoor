import { createHash, timingSafeEqual } from 'node:crypto';
import { Router, json, type Request, type Response } from 'express';

export class ServiceError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export type Principal = { id: string; public_id: string; email: string };
export function internalRouter(limit = '64kb', mountedAtApiPrefix = false) {
  const key = process.env.AUTH_INTERNAL_KEY ?? '';
  if (key.length < 48) throw new Error('Internal authentication configuration missing');
  const router = Router();
  router.use((req, res, next) => {
    if (
      !mountedAtApiPrefix &&
      !req.path.startsWith('/api/v2/') &&
      !req.path.startsWith('/internal/')
    ) {
      next('router');
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    const hash = (s: string) => createHash('sha256').update(s).digest();
    if (!timingSafeEqual(hash(key), hash(req.get('x-internal-key') ?? ''))) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
      return;
    }
    next();
  });
  router.use(json({ limit, inflate: false }));
  return router;
}
export function endpoint(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e) {
      const invalid = e instanceof Error && e.name === 'ZodError';
      res.status(e instanceof ServiceError ? e.status : invalid ? 400 : 503).json({
        error: {
          code: e instanceof ServiceError ? e.code : invalid ? 'INVALID_INPUT' : 'UNAVAILABLE',
        },
      });
    }
  };
}
export async function internalCall<T = Record<string, unknown>>(
  service: string,
  path: string,
  authorization = '',
  body?: unknown,
  method?: string,
  contextHeaders: Record<string, string> = {},
): Promise<T> {
  const key = process.env.AUTH_INTERNAL_KEY ?? '';
  const target = process.env[service.toUpperCase().replaceAll('-', '_') + '_URL'];
  if (!target || key.length < 48) throw new ServiceError(503, 'UNAVAILABLE');
  const response = await fetch(new URL(path, target), {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    redirect: 'error',
    signal: AbortSignal.timeout(
      /^\/(api\/v2\/(matching|payments|finance|payouts|disputes)|internal\/payment)/.test(path)
        ? 60000
        : 15000,
    ),
    headers: {
      ...contextHeaders,
      'content-type': 'application/json',
      'x-internal-key': key,
      authorization,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new ServiceError(response.status, data.error?.code ?? 'UNAVAILABLE');
  return data.data as T;
}
export async function principal(req: Request) {
  return internalCall<Principal>(
    'identity-service',
    '/internal/principal',
    req.get('authorization') ?? '',
  );
}
export async function requirePermission(req: Request, permission: string, scope = 'platform') {
  return internalCall<Principal>(
    'organization-service',
    '/internal/authorize',
    req.get('authorization') ?? '',
    { permission, scope },
  );
}
