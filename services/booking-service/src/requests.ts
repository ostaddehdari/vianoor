import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Pool } from 'pg';
import {
  internalRouter,
  endpoint,
  principal,
  internalCall,
  requirePermission,
  ServiceError,
  transaction,
} from '@vianoor/service-runtime';
export async function initializeRequests(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS session_requests (
  id uuid PRIMARY KEY,client_id uuid NOT NULL,client_code varchar(13) NOT NULL,expert_id uuid NOT NULL,expert_code varchar(13) NOT NULL,
  preferred_date date NOT NULL,status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','reviewed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS session_request_audit(id bigserial PRIMARY KEY,actor_id uuid NOT NULL,request_id uuid NOT NULL,action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());`);
}
export function requestsRouter(pool: Pool) {
  const router = internalRouter();
  router.post(
    '/api/v2/bookings/requests',
    endpoint(async (req, res) => {
      const user = await principal(req);
      const data = z
        .object({
          expert: z.string().regex(/^[A-Za-z0-9]{13}$/),
          preferred_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
        .strict()
        .parse(req.body);
      const date = Date.parse(data.preferred_date);
      const today = Date.parse(new Date().toISOString().slice(0, 10));
      if (
        !Number.isFinite(date) ||
        new Date(date).toISOString().slice(0, 10) !== data.preferred_date ||
        date < today ||
        date > today + 366 * 86400000 ||
        data.expert === user.public_id
      )
        throw new ServiceError(400, 'INVALID_INPUT');
      await internalCall(
        'profile-service',
        '/internal/profile-ready',
        req.get('authorization') ?? '',
      );
      await internalCall('organization-service', '/internal/experts/' + data.expert);
      const expert = await internalCall<{
        id: string;
        disabled_at: string | null;
        verified_at: string | null;
      }>('identity-service', '/internal/accounts/' + data.expert);
      if (expert.disabled_at || !expert.verified_at)
        throw new ServiceError(409, 'EXPERT_UNAVAILABLE');
      const id = randomUUID();
      await transaction(pool, async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [user.id]);
        if (
          (
            await db.query(
              "SELECT 1 FROM session_requests WHERE client_id=$1 AND status='requested' AND (created_at>now()-interval '30 seconds' OR (expert_id=$2 AND preferred_date=$3))",
              [user.id, expert.id, data.preferred_date],
            )
          ).rowCount
        )
          throw new ServiceError(409, 'DUPLICATE_REQUEST');
        await db.query(
          'INSERT INTO session_requests(id,client_id,client_code,expert_id,expert_code,preferred_date) VALUES($1,$2,$3,$4,$5,$6)',
          [id, user.id, user.public_id, expert.id, data.expert, data.preferred_date],
        );
        await db.query(
          "INSERT INTO session_request_audit(actor_id,request_id,action) VALUES($1,$2,'created')",
          [user.id, id],
        );
      });
      res.status(201).json({ data: { id, status: 'requested' } });
    }),
  );
  router.get(
    '/api/v2/bookings/requests',
    endpoint(async (req, res) => {
      const user = await principal(req);
      const view = z.enum(['mine', 'expert', 'secretary']).parse(req.query.view ?? 'mine');
      if (view === 'expert') await requirePermission(req, 'booking.attend');
      if (view === 'secretary') await requirePermission(req, 'booking.support');
      const results = await pool.query(
        `SELECT id,client_code,expert_code,preferred_date::text,status,created_at FROM session_requests
      WHERE ($2='mine' AND client_id=$1) OR ($2='expert' AND expert_id=$1) OR $2='secretary' ORDER BY created_at DESC LIMIT 100`,
        [user.id, view],
      );
      res.json({ data: results.rows });
    }),
  );
  router.patch(
    '/api/v2/bookings/requests/:id',
    endpoint(async (req, res) => {
      const user = await principal(req);
      const id = z.string().uuid().parse(req.params.id);
      const data = z
        .object({ status: z.enum(['reviewed', 'cancelled']) })
        .strict()
        .parse(req.body);
      if (data.status === 'reviewed') await requirePermission(req, 'booking.attend');
      await transaction(pool, async (db) => {
        const row = (await db.query('SELECT * FROM session_requests WHERE id=$1 FOR UPDATE', [id]))
          .rows[0];
        if (!row) throw new ServiceError(404, 'NOT_FOUND');
        if (data.status === 'reviewed' ? row.expert_id !== user.id : row.client_id !== user.id)
          throw new ServiceError(403, 'FORBIDDEN');
        if (row.status !== 'requested') throw new ServiceError(409, 'CONFLICT');
        await db.query('UPDATE session_requests SET status=$2,updated_at=now() WHERE id=$1', [
          id,
          data.status,
        ]);
        await db.query(
          'INSERT INTO session_request_audit(actor_id,request_id,action) VALUES($1,$2,$3)',
          [user.id, id, data.status],
        );
      });
      res.json({ data: { ok: true } });
    }),
  );
  return router;
}
