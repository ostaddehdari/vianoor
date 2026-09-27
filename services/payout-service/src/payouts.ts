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
const destination = z.discriminatedUnion('method', [
  z
    .object({
      method: z.literal('BANK'),
      country: z.string().regex(/^[A-Z]{2}$/),
      bank: z.string().min(2).max(100),
      account: z.string().min(5).max(100),
      holder: z.string().min(2).max(150),
    })
    .strict(),
  z.object({ method: z.literal('PAYPAL'), email: z.string().email().max(200) }).strict(),
  z
    .object({
      method: z.literal('CRYPTO'),
      network: z.enum([
        'usdttrc20',
        'usdterc20',
        'usdtbsc',
        'usdtmatic',
        'usdcmatic',
        'usdc',
        'btc',
        'eth',
      ]),
      address: z.string().regex(/^[A-Za-z0-9:]{20,150}$/),
    })
    .strict(),
]);
export async function initializePayouts(pool: Pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS payout_destinations(id uuid PRIMARY KEY,account_id uuid NOT NULL,method text NOT NULL,sealed_details text NOT NULL,label text NOT NULL,active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now());CREATE TABLE IF NOT EXISTS withdrawals(id uuid PRIMARY KEY,account_id uuid NOT NULL,destination_id uuid NOT NULL REFERENCES payout_destinations(id),amount numeric(30,0) NOT NULL CHECK(amount>0),currency text NOT NULL,decimals int NOT NULL,status text NOT NULL DEFAULT 'REQUESTED',funds_locked boolean NOT NULL DEFAULT false,request_key uuid NOT NULL,provider_reference text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(account_id,request_key));CREATE TABLE IF NOT EXISTS payout_audit(id bigserial PRIMARY KEY,actor_id uuid NOT NULL,withdrawal_id uuid,action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());`,
  );
}
type Withdrawal = {
  id: string;
  account_id: string;
  amount: string;
  currency: string;
  status: string;
  decimals: number;
  destination_id: string;
  funds_locked: boolean;
};
async function wallet(d: Withdrawal, action: string) {
  return internalCall('wallet-service', '/internal/wallet/execute', '', {
    key: 'withdrawal:' + action + ':' + d.id,
    reference: d.id,
    action,
    account_id: d.account_id,
    amount: d.amount,
    currency: d.currency,
  });
}
export async function reconcileWithdrawal(pool: Pool, id: string) {
  return transaction(pool, async (db) => {
    const w = (await db.query('SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE', [id])).rows[0] as
      | Withdrawal
      | undefined;
    if (!w) throw new ServiceError(404, 'NOT_FOUND');
    if (['COMPLETED', 'FAILED', 'REJECTED'].includes(w.status)) return w;
    if (!w.funds_locked) {
      await wallet(w, 'LOCK');
      await db.query('UPDATE withdrawals SET funds_locked=true WHERE id=$1', [id]);
    }
    if (w.status === 'REQUESTED') return { ...w, funds_locked: true };
    const d = (await db.query('SELECT * FROM payout_destinations WHERE id=$1', [w.destination_id]))
        .rows[0],
      details = destination.parse(openJson(d.sealed_details, 'destination:' + d.id));
    if (details.method === 'BANK') return w;
    if (w.status === 'APPROVED') {
      const result = await internalCall<{ reference: string | null; status: string }>(
        'payment-service',
        '/internal/payment/payout',
        '',
        {
          id: w.id,
          provider: details.method === 'PAYPAL' ? 'paypal' : 'nowpayments',
          destination: details.method === 'PAYPAL' ? details.email : details.address,
          amount: w.amount,
          currency: w.currency,
          decimals: w.decimals,
          ...(details.method === 'CRYPTO' ? { network: details.network } : {}),
        },
      );
      await db.query(
        "UPDATE withdrawals SET status='PROCESSING',provider_reference=$2,updated_at=now() WHERE id=$1",
        [id, result.reference],
      );
    }
    const result = await internalCall<{ status: string; reference: string }>(
      'payment-service',
      '/internal/payment/payout/' + id,
    );
    if (result.status === 'COMPLETED' || result.status === 'FAILED') {
      await wallet(w, result.status === 'COMPLETED' ? 'WITHDRAW' : 'UNLOCK');
      await db.query(
        'UPDATE withdrawals SET status=$2,provider_reference=$3,updated_at=now() WHERE id=$1',
        [id, result.status, result.reference],
      );
    }
    return (await db.query('SELECT * FROM withdrawals WHERE id=$1', [id])).rows[0];
  });
}
export function payoutRouter(pool: Pool) {
  const r = internalRouter();
  r.get(
    '/api/v2/payouts/destinations',
    endpoint(async (req, res) => {
      const u = await principal(req);
      res.json({
        data: (
          await pool.query(
            'SELECT id,method,label,active,created_at FROM payout_destinations WHERE account_id=$1 ORDER BY created_at DESC',
            [u.id],
          )
        ).rows,
      });
    }),
  );
  r.post(
    '/api/v2/payouts/destinations',
    endpoint(async (req, res) => {
      const u = await principal(req);
      const d = destination.parse(req.body),
        id = randomUUID(),
        label =
          d.method === 'BANK'
            ? d.bank + ' · ' + d.account.slice(-4)
            : d.method === 'PAYPAL'
              ? 'PayPal · ' + d.email.slice(-8)
              : d.network + ' · ' + d.address.slice(-6);
      await pool.query(
        'INSERT INTO payout_destinations(id,account_id,method,sealed_details,label) VALUES($1,$2,$3,$4,$5)',
        [id, u.id, d.method, sealJson(d, 'destination:' + id), label],
      );
      res.json({ data: { id, method: d.method, label } });
    }),
  );
  r.get(
    '/api/v2/payouts/withdrawals',
    endpoint(async (req, res) => {
      const u = await principal(req);
      res.json({
        data: (
          await pool.query(
            'SELECT w.*,d.method,d.label FROM withdrawals w JOIN payout_destinations d ON d.id=w.destination_id WHERE w.account_id=$1 ORDER BY created_at DESC LIMIT 100',
            [u.id],
          )
        ).rows,
      });
    }),
  );
  r.post(
    '/api/v2/payouts/withdrawals',
    endpoint(async (req, res) => {
      const u = await principal(req);
      const d = z
          .object({
            request_key: uuid,
            destination_id: uuid,
            amount: z.string().regex(/^[1-9][0-9]{0,15}$/),
            currency: z.string().regex(/^[A-Z]{3,6}$/),
          })
          .strict()
          .parse(req.body),
        dest = (
          await pool.query(
            'SELECT id FROM payout_destinations WHERE id=$1 AND account_id=$2 AND active',
            [d.destination_id, u.id],
          )
        ).rows[0];
      if (!dest) throw new ServiceError(403, 'FORBIDDEN');
      const currencies = await internalCall<{ code: string; active: boolean; decimals: number }[]>(
          'accounting-service',
          '/internal/accounting/currencies',
        ),
        c = currencies.find((x) => x.code === d.currency && x.active);
      if (!c) throw new ServiceError(400, 'CURRENCY_UNAVAILABLE');
      const w = (
        await pool.query(
          'INSERT INTO withdrawals(id,account_id,destination_id,amount,currency,decimals,request_key) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(account_id,request_key) DO UPDATE SET request_key=EXCLUDED.request_key RETURNING *',
          [randomUUID(), u.id, d.destination_id, d.amount, d.currency, c.decimals, d.request_key],
        )
      ).rows[0];
      if (
        w.amount !== d.amount ||
        w.currency !== d.currency ||
        w.destination_id !== d.destination_id
      )
        throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT');
      res.json({ data: await reconcileWithdrawal(pool, w.id) });
    }),
  );
  r.get(
    '/api/v2/payouts/admin',
    endpoint(async (req, res) => {
      await requirePermission(req, 'finance.read');
      res.json({
        data: (
          await pool.query(
            'SELECT w.*,d.method,d.label FROM withdrawals w JOIN payout_destinations d ON d.id=w.destination_id ORDER BY created_at DESC LIMIT 200',
          )
        ).rows,
      });
    }),
  );
  r.post(
    '/api/v2/payouts/admin/:id/:action',
    endpoint(async (req, res) => {
      const u = await requirePermission(req, 'finance.manage'),
        id = uuid.parse(req.params.id),
        action = z
          .enum(['approve', 'reject', 'process', 'reconcile', 'complete-bank', 'verify', 'details'])
          .parse(req.params.action),
        d = z
          .object({
            reference: z.string().min(5).max(150).optional(),
            code: z
              .string()
              .regex(/^\d{6}$/)
              .optional(),
          })
          .strict()
          .parse(req.body);
      if (action === 'details') {
        const w = (
          await pool.query(
            'SELECT d.* FROM payout_destinations d JOIN withdrawals w ON w.destination_id=d.id WHERE w.id=$1',
            [id],
          )
        ).rows[0];
        if (!w) throw new ServiceError(404, 'NOT_FOUND');
        await pool.query(
          'INSERT INTO payout_audit(actor_id,withdrawal_id,action) VALUES($1,$2,$3)',
          [u.id, id, 'DETAILS_VIEWED'],
        );
        res.json({ data: openJson(w.sealed_details, 'destination:' + w.id) });
        return;
      }
      if (action === 'verify') {
        if (!d.code) throw new ServiceError(400, 'CODE_REQUIRED');
        res.json({
          data: await internalCall(
            'payment-service',
            '/internal/payment/payout/' + id + '/verify',
            '',
            { code: d.code },
          ),
        });
        return;
      }
      await transaction(pool, async (db) => {
        const w = (
          await db.query(
            'SELECT w.*,d.method FROM withdrawals w JOIN payout_destinations d ON d.id=w.destination_id WHERE w.id=$1 FOR UPDATE OF w',
            [id],
          )
        ).rows[0];
        if (!w) throw new ServiceError(404, 'NOT_FOUND');
        if (action === 'approve' && w.status === 'REQUESTED') {
          if (!w.funds_locked) {
            await wallet(w, 'LOCK');
          }
          await db.query("UPDATE withdrawals SET status='APPROVED',funds_locked=true WHERE id=$1", [
            id,
          ]);
        } else if (action === 'reject' && ['REQUESTED', 'APPROVED'].includes(w.status)) {
          if (w.funds_locked) await wallet(w, 'UNLOCK');
          await db.query("UPDATE withdrawals SET status='REJECTED' WHERE id=$1", [id]);
        } else if (action === 'process' && w.method === 'BANK' && w.status === 'APPROVED')
          await db.query("UPDATE withdrawals SET status='PROCESSING' WHERE id=$1", [id]);
        else if (action === 'complete-bank') {
          if (w.method !== 'BANK' || w.status !== 'PROCESSING' || !d.reference)
            throw new ServiceError(409, 'INVALID_TRANSITION');
          await wallet(w, 'WITHDRAW');
          await db.query(
            "UPDATE withdrawals SET status='COMPLETED',provider_reference=$2 WHERE id=$1",
            [id, d.reference],
          );
        }
        await db.query('INSERT INTO payout_audit(actor_id,withdrawal_id,action) VALUES($1,$2,$3)', [
          u.id,
          id,
          action,
        ]);
      });
      res.json({ data: await reconcileWithdrawal(pool, id) });
    }),
  );
  return r;
}
export function payoutWorker(pool: Pool) {
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void (async () => {
      for (const w of (
        await pool.query(
          "SELECT id FROM withdrawals WHERE status IN ('APPROVED','PROCESSING') ORDER BY updated_at LIMIT 30",
        )
      ).rows) {
        try {
          await reconcileWithdrawal(pool, w.id);
        } catch {
          /* Ambiguous external outcomes retain the wallet lock. */
        }
      }
    })()
      .catch(() => {
        /* Retry transient storage failures on the next tick. */
      })
      .finally(() => {
        busy = false;
      });
  }, 60000);
  timer.unref();
}
