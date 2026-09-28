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
  await pool.query(`CREATE TABLE IF NOT EXISTS live_session_consents(id bigserial PRIMARY KEY,session_id uuid NOT NULL,context_id uuid NOT NULL,purpose text NOT NULL,account_id uuid NOT NULL,accepted boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS live_session_consents_lookup ON live_session_consents(session_id,context_id,purpose,account_id,id DESC);
CREATE TABLE IF NOT EXISTS profile_consents (
  id bigserial PRIMARY KEY,account_id uuid NOT NULL,version int NOT NULL,accepted boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now());`);
}
export function consentRouter(pool: Pool) {
  const router = internalRouter();
  router.post(
    '/internal/session-consent',
    endpoint(async (req, res) => {
      const u = await principal(req),
        d = z
          .object({
            session_id: z.string().uuid(),
            context_id: z.string().uuid(),
            purpose: z.enum(['RECORDING', 'OBSERVER']),
            accepted: z.boolean(),
          })
          .strict()
          .parse(req.body);
      await internalCall(
        'media-service',
        '/internal/sessions/' + d.session_id + '/consent-authorize',
        req.get('authorization') ?? '',
        { context_id: d.context_id, purpose: d.purpose },
      );
      await pool.query(
        'INSERT INTO live_session_consents(session_id,context_id,purpose,account_id,accepted) VALUES($1,$2,$3,$4,$5)',
        [d.session_id, d.context_id, d.purpose, u.id, d.accepted],
      );
      res.json({ data: { ok: true } });
    }),
  );
  router.post(
    '/internal/session-consents',
    endpoint(async (req, res) => {
      const d = z
        .object({
          session_id: z.string().uuid(),
          context_id: z.string().uuid(),
          purpose: z.enum(['RECORDING', 'OBSERVER']),
        })
        .strict()
        .parse(req.body);
      res.json({
        data: (
          await pool.query(
            'SELECT DISTINCT ON(account_id) account_id,accepted,created_at FROM live_session_consents WHERE session_id=$1 AND context_id=$2 AND purpose=$3 ORDER BY account_id,id DESC',
            [d.session_id, d.context_id, d.purpose],
          )
        ).rows,
      });
    }),
  );
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
