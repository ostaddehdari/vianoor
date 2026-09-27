import { z } from 'zod';
import type { Pool } from 'pg';
import { internalRouter, endpoint, ServiceError, transaction } from '@vianoor/service-runtime';
import { gateway } from './payments.js';
import { sendPayout, payoutStatus, verifyPayoutCode } from './providers.js';
export async function initializeProviderPayouts(pool: Pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS provider_payouts(id uuid PRIMARY KEY,gateway_id uuid NOT NULL REFERENCES payment_gateways(id),reference text,item_reference text,status text NOT NULL DEFAULT 'CREATED',created_at timestamptz NOT NULL DEFAULT now());`,
  );
}
export function providerPayoutRouter(pool: Pool) {
  const r = internalRouter();
  r.post(
    '/internal/payment/payout',
    endpoint(async (req, res) => {
      const d = z
        .object({
          id: z.string().uuid(),
          provider: z.enum(['paypal', 'nowpayments']),
          destination: z.string().min(5).max(250),
          amount: z.string().regex(/^[1-9][0-9]{0,29}$/),
          currency: z.string().regex(/^[A-Z]{3,6}$/),
          decimals: z.number().int().min(0).max(18),
          network: z.string().max(30).optional(),
        })
        .strict()
        .parse(req.body);
      const g = (
        await pool.query(
          "SELECT id FROM payment_gateways WHERE provider=$1 AND current AND enabled AND connection_status='CONNECTED'",
          [d.provider],
        )
      ).rows[0];
      if (!g) throw new ServiceError(409, 'GATEWAY_NOT_CONFIGURED');
      await pool.query(
        'INSERT INTO provider_payouts(id,gateway_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [d.id, g.id],
      );
      const claimed = (
        await pool.query(
          "UPDATE provider_payouts SET status='SUBMITTED' WHERE id=$1 AND status='CREATED' RETURNING *",
          [d.id],
        )
      ).rows[0];
      if (claimed) {
        const result = await sendPayout(await gateway(pool, claimed.gateway_id), d);
        if (!result.reference) throw new ServiceError(502, 'PROVIDER_INVALID_RESPONSE');
        await pool.query(
          'UPDATE provider_payouts SET status=$2,reference=$3,item_reference=$4 WHERE id=$1',
          [d.id, result.status, result.reference, result.item_reference],
        );
      }
      res.json({
        data: (
          await pool.query('SELECT id,status,reference FROM provider_payouts WHERE id=$1', [d.id])
        ).rows[0],
      });
    }),
  );
  r.get(
    '/internal/payment/payout/:id',
    endpoint(async (req, res) => {
      const id = z.string().uuid().parse(req.params.id);
      res.json({
        data: await transaction(pool, async (db) => {
          const p = (await db.query('SELECT * FROM provider_payouts WHERE id=$1 FOR UPDATE', [id]))
            .rows[0];
          if (!p) throw new ServiceError(404, 'NOT_FOUND');
          if (!p.reference || ['COMPLETED', 'FAILED'].includes(p.status))
            return { status: p.status, reference: p.reference };
          const result = await payoutStatus(
            await gateway(db, p.gateway_id),
            p.reference,
            p.item_reference,
          );
          await db.query('UPDATE provider_payouts SET status=$2 WHERE id=$1', [id, result.status]);
          return { ...result, reference: p.reference };
        }),
      });
    }),
  );
  r.post(
    '/internal/payment/payout/:id/verify',
    endpoint(async (req, res) => {
      const id = z.string().uuid().parse(req.params.id),
        d = z
          .object({ code: z.string().regex(/^\d{6}$/) })
          .strict()
          .parse(req.body),
        p = (await pool.query('SELECT * FROM provider_payouts WHERE id=$1', [id])).rows[0];
      if (!p?.reference) throw new ServiceError(409, 'PAYOUT_NOT_READY');
      res.json({
        data: await verifyPayoutCode(await gateway(pool, p.gateway_id), p.reference, d.code),
      });
    }),
  );
  return r;
}
