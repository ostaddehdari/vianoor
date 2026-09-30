import { z } from 'zod';
import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
  internalRouter,
  endpoint,
  principal,
  internalCall,
} from '@vianoor/service-runtime';
if (process.env.COMMUNICATIONS_ENABLED !== '1') await bootstrap('presence-service', 4107);
else {
  const infra = await connectInfrastructure('presence-service'),
    r = internalRouter();
  r.get(
    '/api/v2/presence/public',
    endpoint(async (req, res) => {
      const raw = String(req.query.experts ?? '');

      const codes = z
        .array(z.string().regex(/^[A-Za-z0-9]{13}$/))
        .max(50)
        .parse(raw ? raw.split(',').filter(Boolean) : []);

      if (!codes.length) {
        res.json({ data: [] });
        return;
      }

      const identities = await internalCall<
        { account_id: string; expert_code: string }[]
      >(
        'scholar-service',
        '/internal/discovery/identities?' +
          new URLSearchParams({
            codes: codes.join(','),
          }),
      );

      res.json({
        data: await Promise.all(
          identities.map(async (identity) => ({
            expert_code: identity.expert_code,
            state:
              (await infra.redis.get(
                'presence:' + identity.account_id,
              )) ?? 'OFFLINE',
          })),
        ),
      });
    }),
  );

  r.post(
    '/internal/presence/heartbeat',
    endpoint(async (req, res) => {
      const u = await principal(req),
        d = z
          .object({ state: z.enum(['ONLINE', 'AWAY']) })
          .strict()
          .parse(req.body);
      await infra.redis.set('presence:' + u.id, d.state, { EX: 75 });
      res.json({ data: { state: d.state } });
    }),
  );
  r.get(
    '/api/v2/presence/:conversation',
    endpoint(async (req, res) => {
      await principal(req);
      const id = z.string().uuid().parse(req.params.conversation);
      await internalCall(
        'messaging-service',
        '/internal/communications/authorize',
        req.get('authorization') ?? '',
        { conversation_id: id },
      );
      const response = await internalCall<{ account_id: string }[]>(
        'messaging-service',
        '/internal/communications/members/' + id,
        req.get('authorization') ?? '',
      );
      res.json({
        data: await Promise.all(
          response.map(async (m) => ({
            account_id: m.account_id,
            state: (await infra.redis.get('presence:' + m.account_id)) ?? 'OFFLINE',
          })),
        ),
      });
    }),
  );
  const app = await createService('presence-service', {
      infrastructure: infra,
      ready: infra.healthy,
      configure: (a) => a.use(r),
    }),
    c = readRuntimeConfig(4107);
  await app.listen(c.port, c.host);
}
