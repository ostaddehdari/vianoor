import { Router, json } from 'express';
import { z } from 'zod';
import { setTimeout as pause } from 'node:timers/promises';
import { currentTraceId } from '@vianoor/service-runtime';
import { Identity } from './identity.js';
import { AuthError, equalSecret, rateLimit, type RateStore } from './security.js';
const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(15).max(128);
const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const locale = z.enum(['fa', 'en']).default('fa');
const schemas = {
  register: z.object({ email, password, locale }).strict(),
  login: z.object({ email, password: z.string().min(1).max(128) }).strict(),
  'forgot-password': z.object({ email, locale }).strict(),
  'resend-verification': z.object({ email, locale }).strict(),
  'verify-email': z.object({ token: secret }).strict(),
  'reset-password': z.object({ token: secret, password }).strict(),
  refresh: z.object({ refresh: secret }).strict(),
  logout: z.object({ refresh: secret.optional() }).strict(),
  revoke: z.object({ id: z.string().uuid().optional() }).strict(),
};
export function identityRouter(identity: Identity, redis: RateStore) {
  const router = Router();
  let active = 0;
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!equalSecret(req.get('x-internal-key') ?? '', identity.config.apiKey)) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
      return;
    }
    next();
  });
  router.use(json({ limit: '8kb', inflate: false }));
  router.all('/:action', async (req, res) => {
    const started = Date.now();
    const action = String(req.params.action);
    const access = req.get('authorization')?.replace(/^Bearer /, '') ?? '';
    let acquired = false;
    try {
      if (active >= 4) throw new AuthError(503, 'BUSY');
      active++;
      acquired = true;
      await rateLimit(redis, 'client:' + (req.get('x-auth-client') ?? 'unknown'), 120, 60);
      if (action === 'session' && req.method === 'GET') {
        res.json({ data: await identity.sessions(access) });
        return;
      }
      if (req.method !== 'POST' || !Object.hasOwn(schemas, action))
        throw new AuthError(404, 'NOT_FOUND');
      const parsed = schemas[action as keyof typeof schemas].safeParse(req.body);
      if (!parsed.success) throw new AuthError(400, 'INVALID_INPUT');
      const data = parsed.data;
      if ('email' in data)
        await rateLimit(redis, 'email:' + action + ':' + data.email, action === 'login' ? 8 : 4);
      if (action === 'refresh')
        await rateLimit(redis, 'refresh:' + ('refresh' in data ? data.refresh : ''), 30, 60);
      let result: unknown = { ok: true };
      switch (action) {
        case 'register': {
          const d = schemas.register.parse(data);
          await identity.register(d.email, d.password, d.locale);
          break;
        }
        case 'login': {
          const d = schemas.login.parse(data);
          result = await identity.login(d.email, d.password);
          break;
        }
        case 'forgot-password':
        case 'resend-verification': {
          const d = schemas['forgot-password'].parse(data);
          await identity.requestMail(
            d.email,
            action === 'forgot-password' ? 'reset' : 'verify',
            d.locale,
          );
          break;
        }
        case 'verify-email':
          await identity.consume(schemas['verify-email'].parse(data).token, 'verify');
          break;
        case 'reset-password': {
          const d = schemas['reset-password'].parse(data);
          await identity.consume(d.token, 'reset', d.password);
          break;
        }
        case 'refresh':
          result = await identity.refresh(schemas.refresh.parse(data).refresh);
          break;
        case 'logout': {
          const d = schemas.logout.parse(data);
          if (d.refresh) await identity.logout(d.refresh);
          break;
        }
        case 'revoke':
          await identity.revoke(access, schemas.revoke.parse(data).id);
          break;
      }
      if (['register', 'forgot-password', 'resend-verification'].includes(action))
        await pause(Math.max(0, 250 - (Date.now() - started)));
      res.json({ data: result, trace_id: currentTraceId() });
    } catch (error) {
      const known = error instanceof AuthError;
      if (known && error.status === 429) res.setHeader('Retry-After', '900');
      res.status(known ? error.status : 503).json({
        error: {
          code: known ? error.code : 'UNAVAILABLE',
          message: 'Request failed',
          details: {},
        },
        trace_id: currentTraceId(),
      });
    } finally {
      if (acquired) active--;
    }
  });
  return router;
}
