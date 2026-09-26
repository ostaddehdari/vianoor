import { z } from 'zod';
import type { Pool } from 'pg';
import {
  internalRouter,
  endpoint,
  principal,
  internalCall,
  ServiceError,
} from '@vianoor/service-runtime';
const version = 1;
export async function initializeConsent(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS profile_consents (
  id bigserial PRIMARY KEY,account_id uuid NOT NULL,version int NOT NULL,accepted boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now());`);
}
export function consentRouter(pool: Pool) {
  const router = internalRouter();
  const current = async (id: string) =>
    (
      await pool.query(
        'SELECT version,accepted FROM profile_consents WHERE account_id=$1 ORDER BY id DESC LIMIT 1',
        [id],
      )
    ).rows[0];
  router.get(
    '/api/v2/consents/profile',
    endpoint(async (req, res) => {
      const user = await principal(req);
      const consent = await current(user.id);
      res.json({ data: { version, accepted: consent?.version === version && consent.accepted } });
    }),
  );
  router.post(
    '/api/v2/consents/profile',
    endpoint(async (req, res) => {
      const user = await principal(req);
      const data = z
        .object({ version: z.literal(version), accepted: z.boolean() })
        .strict()
        .parse(req.body);
      await pool.query(
        'INSERT INTO profile_consents(account_id,version,accepted) VALUES($1,$2,$3)',
        [user.id, version, data.accepted],
      );
      res.json({ data: { ok: true } });
    }),
  );
  router.get(
    '/internal/profile-consent',
    endpoint(async (req, res) => {
      const user = await principal(req);
      const consent = await current(user.id);
      if (consent?.version !== version || !consent.accepted)
        throw new ServiceError(409, 'CONSENT_REQUIRED');
      res.json({ data: { ok: true } });
    }),
  );
  router.get(
    '/internal/profile-sharing/:code',
    endpoint(async (req, res) => {
      const code = z
        .string()
        .regex(/^[A-Za-z0-9]{13}$/)
        .parse(req.params.code);
      const account = await internalCall<{ id: string; disabled_at: string | null }>(
        'identity-service',
        '/internal/accounts/' + code,
      );
      const consent = await current(account.id);
      res.json({
        data: {
          accepted: !!(!account.disabled_at && consent?.version === version && consent.accepted),
        },
      });
    }),
  );
  return router;
}
