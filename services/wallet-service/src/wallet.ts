import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Pool } from 'pg';
import {
  internalRouter,
  endpoint,
  principal,
  internalCall,
  ServiceError,
  transaction,
} from '@vianoor/service-runtime';
const minor = z.string().regex(/^(0|[1-9][0-9]{0,29})$/),
  currency = z.string().regex(/^[A-Z]{3,6}$/);
const command = z
  .object({
    key: z.string().min(8).max(140),
    reference: z.string().uuid(),
    action: z.enum([
      'TOPUP',
      'PURCHASE',
      'EXTERNAL_PURCHASE',
      'RELEASE',
      'REFUND_PENDING',
      'REFUND_AVAILABLE',
      'TOPUP_REFUND',
      'REFUND_LOCK_PENDING',
      'REFUND_LOCK_AVAILABLE',
      'REFUND_LOCK_TOPUP',
      'REFUND_SEND',
      'LOCK',
      'UNLOCK',
      'WITHDRAW',
      'FX',
    ]),
    account_id: z.string().uuid(),
    expert_id: z.string().uuid().optional(),
    currency,
    amount: minor,
    fee: minor.default('0'),
    tax: minor.default('0'),
    quote_id: z.string().uuid().optional(),
    external: z.boolean().default(false),
  })
  .strict();
type Command = z.infer<typeof command>;
type Line = { owner: string | null; kind: string; currency: string; debit: string; credit: string };
export async function initializeWallet(pool: Pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS wallet_operations(idempotency_key text PRIMARY KEY,fingerprint text NOT NULL,account_id uuid NOT NULL,reference uuid NOT NULL,action text NOT NULL,request jsonb NOT NULL,status text NOT NULL DEFAULT 'PENDING',journal_id uuid,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());CREATE INDEX IF NOT EXISTS wallet_pending ON wallet_operations(updated_at) WHERE status='PENDING';`,
  );
}
async function linesFor(d: Command): Promise<{ lines: Line[]; metadata: Record<string, string> }> {
  const amount = BigInt(d.amount),
    fee = BigInt(d.fee),
    tax = BigInt(d.tax);
  if (amount <= 0n || fee + tax > amount) throw new ServiceError(400, 'INVALID_AMOUNT');
  const lines: Line[] = [];
  const add = (
    owner: string | null,
    kind: string,
    value: bigint,
    credit: boolean,
    c = d.currency,
  ) => {
    if (value)
      lines.push({
        owner,
        kind,
        currency: c,
        debit: credit ? '0' : value.toString(),
        credit: credit ? value.toString() : '0',
      });
  };
  if (
    [
      'PURCHASE',
      'EXTERNAL_PURCHASE',
      'RELEASE',
      'REFUND_PENDING',
      'REFUND_AVAILABLE',
      'REFUND_LOCK_PENDING',
      'REFUND_LOCK_AVAILABLE',
    ].includes(d.action) &&
    !d.expert_id
  )
    throw new ServiceError(400, 'EXPERT_REQUIRED');
  switch (d.action) {
    case 'TOPUP':
      add(null, 'PROVIDER', amount, false);
      add(d.account_id, 'AVAILABLE', amount, true);
      break;
    case 'TOPUP_REFUND':
      add(d.account_id, 'AVAILABLE', amount, false);
      add(null, 'PROVIDER', amount, true);
      break;
    case 'REFUND_LOCK_TOPUP':
      add(d.account_id, 'AVAILABLE', amount, false);
      add(null, 'HOLDING', amount, true);
      break;
    case 'REFUND_LOCK_PENDING':
    case 'REFUND_LOCK_AVAILABLE':
      add(
        d.expert_id!,
        d.action === 'REFUND_LOCK_PENDING' ? 'PENDING' : 'AVAILABLE',
        amount - fee - tax,
        false,
      );
      add(null, d.action === 'REFUND_LOCK_PENDING' ? 'HOLDING' : 'REVENUE', fee, false);
      add(null, 'TAX', tax, false);
      add(null, 'HOLDING', amount, true);
      break;
    case 'REFUND_SEND':
      add(null, 'HOLDING', amount, false);
      add(d.external ? null : d.account_id, d.external ? 'PROVIDER' : 'AVAILABLE', amount, true);
      break;
    case 'PURCHASE':
    case 'EXTERNAL_PURCHASE':
      add(
        d.action === 'PURCHASE' ? d.account_id : null,
        d.action === 'PURCHASE' ? 'AVAILABLE' : 'PROVIDER',
        amount,
        false,
      );
      add(d.expert_id!, 'PENDING', amount - fee - tax, true);
      add(null, 'HOLDING', fee, true);
      add(null, 'TAX', tax, true);
      break;
    case 'RELEASE':
      add(d.expert_id!, 'PENDING', amount - fee - tax, false);
      add(d.expert_id!, 'AVAILABLE', amount - fee - tax, true);
      add(null, 'HOLDING', fee, false);
      add(null, 'REVENUE', fee, true);
      break;
    case 'REFUND_PENDING':
    case 'REFUND_AVAILABLE':
      add(
        d.expert_id!,
        d.action === 'REFUND_PENDING' ? 'PENDING' : 'AVAILABLE',
        amount - fee - tax,
        false,
      );
      add(null, d.action === 'REFUND_PENDING' ? 'HOLDING' : 'REVENUE', fee, false);
      add(null, 'TAX', tax, false);
      add(d.external ? null : d.account_id, d.external ? 'PROVIDER' : 'AVAILABLE', amount, true);
      break;
    case 'LOCK':
      add(d.account_id, 'AVAILABLE', amount, false);
      add(d.account_id, 'LOCKED', amount, true);
      break;
    case 'UNLOCK':
      add(d.account_id, 'LOCKED', amount, false);
      add(d.account_id, 'AVAILABLE', amount, true);
      break;
    case 'WITHDRAW':
      add(d.account_id, 'LOCKED', amount, false);
      add(null, 'PROVIDER', amount, true);
      break;
    case 'FX': {
      if (!d.quote_id) throw new ServiceError(400, 'QUOTE_REQUIRED');
      const q = await internalCall<{
        id: string;
        account_id: string;
        expires_at: string;
        base: string;
        quote: string;
        source_minor: string;
        target_minor: string;
        numerator: string;
        denominator: string;
        rate_id: string;
      }>('accounting-service', '/internal/accounting/quotes/' + d.quote_id);
      if (q.account_id !== d.account_id || q.source_minor !== d.amount || q.base !== d.currency)
        throw new ServiceError(403, 'FORBIDDEN');
      add(d.account_id, 'AVAILABLE', amount, false);
      add(null, 'CLEARING', amount, true);
      add(null, 'CLEARING', BigInt(q.target_minor), false, q.quote);
      add(d.account_id, 'AVAILABLE', BigInt(q.target_minor), true, q.quote);
      return {
        lines,
        metadata: {
          rate_id: q.rate_id,
          quote_id: q.id,
          numerator: q.numerator,
          denominator: q.denominator,
        },
      };
    }
  }
  return { lines, metadata: {} };
}
export async function executeWallet(pool: Pool, value: unknown) {
  const d = command.parse(value),
    fingerprint = createHash('sha256').update(JSON.stringify(d)).digest('hex');
  await transaction(pool, async (db) => {
    await db.query(
      'INSERT INTO wallet_operations(idempotency_key,fingerprint,account_id,reference,action,request) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
      [d.key, fingerprint, d.account_id, d.reference, d.action, d],
    );
    const old = (
      await db.query('SELECT fingerprint FROM wallet_operations WHERE idempotency_key=$1', [d.key])
    ).rows[0];
    if (old.fingerprint !== fingerprint) throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT');
  });
  return transaction(pool, async (db) => {
    const row = (
      await db.query('SELECT * FROM wallet_operations WHERE idempotency_key=$1 FOR UPDATE', [d.key])
    ).rows[0];
    if (row.status === 'COMPLETED') return { id: row.journal_id, duplicate: true };
    const journal = await internalCall<{ id: string }>(
      'accounting-service',
      '/internal/accounting/post',
      '',
      {
        key: 'wallet:' + d.key,
        reference: d.reference,
        description: d.action,
        ...(await linesFor(d)),
      },
    );
    await db.query(
      "UPDATE wallet_operations SET status='COMPLETED',journal_id=$2,updated_at=now() WHERE idempotency_key=$1",
      [d.key, journal.id],
    );
    return journal;
  });
}
export function walletRouter(pool: Pool) {
  const r = internalRouter();
  r.post(
    '/internal/wallet/execute',
    endpoint(async (req, res) => res.json({ data: await executeWallet(pool, req.body) })),
  );
  r.get(
    '/api/v2/wallet',
    endpoint(async (req, res) => {
      const u = await principal(req);
      res.json({
        data: await internalCall('accounting-service', '/internal/accounting/balances/' + u.id),
      });
    }),
  );
  r.get(
    '/api/v2/wallet/history',
    endpoint(async (req, res) => {
      const u = await principal(req);
      res.json({
        data: await internalCall('accounting-service', '/internal/accounting/history/' + u.id),
      });
    }),
  );
  r.post(
    '/api/v2/wallet/exchange',
    endpoint(async (req, res) => {
      const u = await principal(req),
        d = z.object({ quote_id: z.string().uuid() }).strict().parse(req.body);
      const q = await internalCall<{
        account_id: string;
        expires_at: string;
        base: string;
        source_minor: string;
      }>('accounting-service', '/internal/accounting/quotes/' + d.quote_id);
      if (q.account_id !== u.id) throw new ServiceError(403, 'FORBIDDEN');
      const existing = (
        await pool.query('SELECT 1 FROM wallet_operations WHERE idempotency_key=$1', [
          'fx:' + d.quote_id,
        ])
      ).rowCount;
      if (!existing && Date.parse(q.expires_at) <= Date.now())
        throw new ServiceError(409, 'QUOTE_EXPIRED');
      res.json({
        data: await executeWallet(pool, {
          key: 'fx:' + d.quote_id,
          reference: d.quote_id,
          action: 'FX',
          account_id: u.id,
          amount: q.source_minor,
          currency: q.base,
          quote_id: d.quote_id,
        }),
      });
    }),
  );
  return r;
}
