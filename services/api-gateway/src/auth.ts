import { Router, json } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { traceContext } from '@vianoor/service-runtime';
export function authProxy(target: string, key: string) {
  if (key.length < 48) throw new Error('AUTH_INTERNAL_KEY missing');
  const router = Router();
  const actions = new Set([
    'register',
    'login',
    'forgot-password',
    'resend-verification',
    'verify-email',
    'reset-password',
    'refresh',
    'logout',
    'session',
    'revoke',
  ]);
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (
      !timingSafeEqual(
        createHash('sha256')
          .update(req.get('x-internal-key') ?? '')
          .digest(),
        createHash('sha256').update(key).digest(),
      )
    ) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
      return;
    }
    next();
  });
  router.use(json({ limit: '8kb', inflate: false }));
  router.all('/:action', async (req, res) => {
    const action = String(req.params.action);
    if (!actions.has(action) || req.method !== (action === 'session' ? 'GET' : 'POST')) {
      res.status(404).json({ error: { code: 'NOT_FOUND' } });
      return;
    }
    try {
      const result = await fetch(new URL(`/api/v1/auth/${action}`, target), {
        method: req.method,
        redirect: 'error',
        signal: AbortSignal.timeout(12000),
        headers: {
          'content-type': 'application/json',
          'x-internal-key': key,
          authorization: req.get('authorization') ?? '',
          'x-auth-client': req.get('x-auth-client') ?? 'unknown',
          traceparent: traceContext.getStore()!.traceparent,
        },
        ...(req.method === 'POST' ? { body: JSON.stringify(req.body) } : {}),
      });
      const retry = result.headers.get('retry-after');
      if (retry) res.setHeader('Retry-After', retry);
      res.status(result.status).json(await result.json());
    } catch {
      res.status(503).json({ error: { code: 'UNAVAILABLE' } });
    }
  });
  return router;
}
