import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
  internalRouter,
  endpoint,
  principal,
  internalCall,
  ServiceError,
} from '@vianoor/service-runtime';
import { z } from 'zod';
if (process.env.DISCOVERY_ENABLED !== '1') await bootstrap('matching-service', 4108);
else {
  const infra = await connectInfrastructure('matching-service');
  const router = internalRouter();
  router.post(
    '/api/v2/matching/expert',
    endpoint(async (req, res) => {
      await principal(req);
      const input = z
        .object({
          intent: z.string().trim().max(300),
          language: z
            .string()
            .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
            .max(35),
          spoken_language: z
            .string()
            .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
            .max(35),
          local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
          timezone: z.string().max(80),
          disambiguation: z.enum(['reject', 'earlier', 'later']).default('reject'),
          offset: z.number().int().min(0).max(3000).default(0),
        })
        .strict()
        .parse(req.body);
      const auth = req.get('authorization') ?? '';
      const instant = await internalCall<{ utc: string }>(
        'availability-service',
        '/api/v2/availability/resolve',
        auth,
        { local: input.local, timezone: input.timezone, disambiguation: input.disambiguation },
      );
      const query = new URLSearchParams({
        q: input.intent,
        language: input.language,
        spoken_language: input.spoken_language,
        offset: String(input.offset),
        limit: '10',
      });
      const candidates = await internalCall<{
        items: { code: string; services: { id: string; booking_required: boolean }[] }[];
        next_offset: number | null;
      }>('search-service', '/api/v2/search/experts?' + query);
      const items = [];
      for (const candidate of candidates.items) {
        const available = [];
        for (const service of candidate.services.filter((s) => s.booking_required)) {
          const params = new URLSearchParams({
            expert: candidate.code,
            service: service.id,
            from: instant.utc,
            to: new Date(Date.parse(instant.utc) + 60000).toISOString(),
            timezone: input.timezone,
          });
          try {
            const result = await internalCall<{ slots: { start_at: string; end_at: string }[] }>(
              'availability-service',
              '/api/v2/availability/slots?' + params,
              auth,
            );
            if (result.slots.length) available.push({ service_id: service.id, ...result.slots[0] });
          } catch (error) {
            if (
              !(
                error instanceof ServiceError &&
                ['SERVICE_UNAVAILABLE', 'EXPERT_UNAVAILABLE', 'NOT_FOUND'].includes(error.code)
              )
            )
              throw error;
          }
        }
        if (available.length) items.push({ ...candidate, available });
      }
      res.json({
        data: {
          items,
          next_offset: candidates.next_offset,
          at: instant.utc,
          timezone: input.timezone,
        },
      });
    }),
  );
  const app = await createService('matching-service', {
      infrastructure: infra,
      ready: infra.healthy,
      configure: (app) => app.use(router),
    }),
    config = readRuntimeConfig(4108);
  await app.listen(config.port, config.host);
}
