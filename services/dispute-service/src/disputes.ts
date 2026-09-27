import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Pool } from 'pg';
import {
  internalRouter,
  endpoint,
  principal,
  requirePermission,
  internalCall,
  ServiceError,
  transaction,
  sealJson,
  openJson,
} from '@vianoor/service-runtime';
const uuid = z.string().uuid();
export async function initializeDisputes(pool: Pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS financial_disputes(id uuid PRIMARY KEY,booking_id uuid UNIQUE NOT NULL,payment_id uuid NOT NULL,client_id uuid NOT NULL,expert_id uuid NOT NULL,opened_by uuid NOT NULL,reason text NOT NULL,status text NOT NULL DEFAULT 'OPEN',decision text,created_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz);CREATE TABLE IF NOT EXISTS dispute_messages(id uuid PRIMARY KEY,dispute_id uuid NOT NULL REFERENCES financial_disputes(id),actor_id uuid NOT NULL,sealed_message text NOT NULL,attachments jsonb NOT NULL DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT now());CREATE TABLE IF NOT EXISTS dispute_audit(id bigserial PRIMARY KEY,actor_id uuid NOT NULL,dispute_id uuid NOT NULL,action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());`,
  );
}
export function disputesRouter(pool: Pool) {
  const r = internalRouter();
  r.get(
    '/internal/disputes/payment/:id',
    endpoint(async (req, res) => {
      const id = uuid.parse(req.params.id);
      res.json({
        data: {
          open: !!(
            await pool.query(
              "SELECT 1 FROM financial_disputes WHERE payment_id=$1 AND status='OPEN'",
              [id],
            )
          ).rowCount,
        },
      });
    }),
  );
  r.get(
    '/api/v2/disputes',
    endpoint(async (req, res) => {
      const u = await principal(req),
        admin = req.query.admin === '1';
      if (admin) await requirePermission(req, 'dispute.manage');
      res.json({
        data: (
          await pool.query(
            'SELECT * FROM financial_disputes WHERE $2::boolean OR client_id=$1 OR expert_id=$1 ORDER BY created_at DESC LIMIT 200',
            [u.id, admin],
          )
        ).rows,
      });
    }),
  );
  r.post(
    '/api/v2/disputes',
    endpoint(async (req, res) => {
      const u = await principal(req),
        d = z
          .object({ booking_id: uuid, reason: z.enum(['NO_SHOW', 'QUALITY', 'REFUND', 'OTHER']) })
          .strict()
          .parse(req.body),
        b = await internalCall<{ client_id: string; expert_id: string; status: string }>(
          'booking-service',
          '/internal/bookings/financial-state/' + d.booking_id,
        ),
        p = await internalCall<{ id: string; status: string; released_at: string | null }>(
          'payment-service',
          '/internal/payments/booking/' + d.booking_id,
        );
      if (!p || p.status !== 'SUCCESS') throw new ServiceError(409, 'PAID_BOOKING_REQUIRED');
      if (u.id !== b.client_id && u.id !== b.expert_id) throw new ServiceError(403, 'FORBIDDEN');
      const id = randomUUID();
      const row = (
        await pool.query(
          'INSERT INTO financial_disputes(id,booking_id,payment_id,client_id,expert_id,opened_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(booking_id) DO UPDATE SET booking_id=EXCLUDED.booking_id RETURNING *',
          [id, d.booking_id, p.id, b.client_id, b.expert_id, u.id, d.reason],
        )
      ).rows[0];
      await internalCall('payment-service', '/internal/payments/' + p.id + '/dispute', '', {
        open: row.status === 'OPEN',
      });
      res.json({ data: row });
    }),
  );
  r.get(
    '/api/v2/disputes/:id/messages',
    endpoint(async (req, res) => {
      const u = await principal(req),
        id = uuid.parse(req.params.id),
        d = (await pool.query('SELECT * FROM financial_disputes WHERE id=$1', [id])).rows[0];
      if (!d) throw new ServiceError(404, 'NOT_FOUND');
      if (![d.client_id, d.expert_id].includes(u.id))
        await requirePermission(req, 'dispute.manage');
      res.json({
        data: (
          await pool.query(
            'SELECT * FROM dispute_messages WHERE dispute_id=$1 ORDER BY created_at LIMIT 200',
            [id],
          )
        ).rows.map((m) => ({
          id: m.id,
          actor_id: m.actor_id,
          created_at: m.created_at,
          attachments: m.attachments,
          message: openJson(m.sealed_message, 'dispute-message:' + m.id),
        })),
      });
    }),
  );
  r.post(
    '/api/v2/disputes/:id/messages',
    endpoint(async (req, res) => {
      const u = await principal(req),
        id = uuid.parse(req.params.id),
        input = z
          .object({
            message: z.string().trim().min(1).max(5000),
            attachments: z.array(uuid).max(5).default([]),
          })
          .strict()
          .parse(req.body),
        d = (await pool.query('SELECT * FROM financial_disputes WHERE id=$1', [id])).rows[0];
      if (!d) throw new ServiceError(404, 'NOT_FOUND');
      if (![d.client_id, d.expert_id].includes(u.id))
        await requirePermission(req, 'dispute.manage');
      if (d.status !== 'OPEN') throw new ServiceError(409, 'DISPUTE_CLOSED');
      for (const file of input.attachments)
        await internalCall(
          'file-service',
          '/api/v2/files/assets/' + file,
          req.get('authorization') ?? '',
        );
      const messageId = randomUUID();
      await pool.query(
        'INSERT INTO dispute_messages(id,dispute_id,actor_id,sealed_message,attachments) VALUES($1,$2,$3,$4,$5)',
        [
          messageId,
          id,
          u.id,
          sealJson(input.message, 'dispute-message:' + messageId),
          JSON.stringify(input.attachments),
        ],
      );
      res.json({ data: { id: messageId } });
    }),
  );
  r.post(
    '/api/v2/disputes/:id/resolve',
    endpoint(async (req, res) => {
      const u = await requirePermission(req, 'dispute.manage'),
        id = uuid.parse(req.params.id),
        d = z
          .object({ decision: z.enum(['REFUND_WALLET', 'RELEASE', 'REJECT']) })
          .strict()
          .parse(req.body);
      const row = await transaction(pool, async (db) => {
        const row = (
          await db.query('SELECT * FROM financial_disputes WHERE id=$1 FOR UPDATE', [id])
        ).rows[0];
        if (!row) throw new ServiceError(404, 'NOT_FOUND');
        if (row.status === 'RESOLVED') {
          if (row.decision !== d.decision) throw new ServiceError(409, 'CONFLICT');
          return row;
        }
        if (d.decision === 'REFUND_WALLET')
          await internalCall(
            'payment-service',
            '/internal/payments/' + row.payment_id + '/dispute-refund',
            '',
            { dispute_id: id },
          );
        await internalCall(
          'payment-service',
          '/internal/payments/' + row.payment_id + '/dispute',
          '',
          { open: false },
        );
        await db.query(
          "UPDATE financial_disputes SET status='RESOLVED',decision=$2,resolved_at=now() WHERE id=$1",
          [id, d.decision],
        );
        await db.query('INSERT INTO dispute_audit(actor_id,dispute_id,action) VALUES($1,$2,$3)', [
          u.id,
          id,
          d.decision,
        ]);
        return { ...row, status: 'RESOLVED', decision: d.decision };
      });
      res.json({ data: row });
    }),
  );
  return r;
}
export function disputeWorker(pool: Pool) {
  const timer = setInterval(() => {
    void (async () => {
      for (const d of (
        await pool.query("SELECT payment_id FROM financial_disputes WHERE status='OPEN' LIMIT 100")
      ).rows)
        await internalCall(
          'payment-service',
          '/internal/payments/' + d.payment_id + '/dispute',
          '',
          { open: true },
        );
    })().catch(() => {});
  }, 30000);
  timer.unref();
}
