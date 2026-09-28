import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  internalRouter,
  endpoint,
  principal,
  internalCall,
  ServiceError,
  sealJson,
  openJson,
} from '@vianoor/service-runtime';
export async function initializeRatings(pool: Pool) {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS session_ratings(id uuid PRIMARY KEY,session_id uuid NOT NULL UNIQUE,booking_id uuid NOT NULL UNIQUE,client_id uuid NOT NULL,expert_id uuid NOT NULL,overall int NOT NULL CHECK(overall BETWEEN 1 AND 5),punctuality int NOT NULL CHECK(punctuality BETWEEN 1 AND 5),communication int NOT NULL CHECK(communication BETWEEN 1 AND 5),technical int NOT NULL CHECK(technical BETWEEN 1 AND 5),technical_issues jsonb NOT NULL,sealed_review text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());',
  );
}
export function ratingsRouter(pool: Pool) {
  const r = internalRouter();
  r.post(
    '/api/v2/ratings',
    endpoint(async (req, res) => {
      const u = await principal(req),
        score = z.number().int().min(1).max(5),
        d = z
          .object({
            session_id: z.string().uuid(),
            overall: score,
            punctuality: score,
            communication: score,
            technical: score,
            technical_issues: z
              .array(z.enum(['AUDIO', 'VIDEO', 'DISCONNECT', 'JOIN', 'SCREEN_SHARE']))
              .max(5),
            review: z.string().max(3000).default(''),
          })
          .strict()
          .parse(req.body),
        s = await internalCall<{
          state: string;
          booking_id: string;
          client_id: string;
          expert_id: string;
        }>('media-service', '/internal/sessions/' + d.session_id + '/evidence'),
        b = await internalCall<{ status: string; client_id: string }>(
          'booking-service',
          '/internal/bookings/financial-state/' + s.booking_id,
        );
      if (
        s.state !== 'COMPLETED' ||
        b.status !== 'COMPLETED' ||
        s.client_id !== u.id ||
        b.client_id !== u.id
      )
        throw new ServiceError(403, 'VERIFIED_COMPLETED_BOOKING_REQUIRED');
      await pool.query(
        'INSERT INTO session_ratings(id,session_id,booking_id,client_id,expert_id,overall,punctuality,communication,technical,technical_issues,sealed_review) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(session_id) DO UPDATE SET overall=$6,punctuality=$7,communication=$8,technical=$9,technical_issues=$10,sealed_review=$11 WHERE session_ratings.client_id=$4',
        [
          randomUUID(),
          d.session_id,
          s.booking_id,
          u.id,
          s.expert_id,
          d.overall,
          d.punctuality,
          d.communication,
          d.technical,
          JSON.stringify(d.technical_issues),
          sealJson(d.review, 'rating:' + d.session_id, 'SESSION_ENCRYPTION_KEY'),
        ],
      );
      res.json({ data: { ok: true } });
    }),
  );
  r.get(
    '/api/v2/ratings',
    endpoint(async (req, res) => {
      const u = await principal(req);
      res.json({
        data: (
          await pool.query(
            'SELECT * FROM session_ratings WHERE client_id=$1 ORDER BY created_at DESC LIMIT 100',
            [u.id],
          )
        ).rows.map((r) => ({
          session_id: r.session_id,
          overall: r.overall,
          punctuality: r.punctuality,
          communication: r.communication,
          technical: r.technical,
          technical_issues: r.technical_issues,
          review: openJson(r.sealed_review, 'rating:' + r.session_id, 'SESSION_ENCRYPTION_KEY'),
        })),
      });
    }),
  );
  return r;
}
