import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
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
import { paymentRisk } from './risk.js';
import {
  createProviderPayment,
  verifyProviderPayment,
  verifyWebhook,
  checkGateway,
  refundProvider,
  networkCodes,
  type Gateway,
} from './providers.js';
const uuid = z.string().uuid(),
  minor = z.string().regex(/^[1-9][0-9]{0,15}$/),
  currency = z.string().regex(/^[A-Z]{3,6}$/),
  provider = z.enum(['stripe', 'paypal', 'nowpayments']);
type Payment = {
  request_data: Record<string, unknown>;
  id: string;
  account_id: string;
  booking_id: string | null;
  expert_id: string | null;
  gateway_id: string | null;
  provider: string;
  amount: string;
  fee: string;
  tax: string;
  currency: string;
  decimals: number;
  status: string;
  reference: string | null;
  capture_reference: string | null;
  checkout: Record<string, string>;
  network: string | null;
  snapshot: Record<string, unknown>;
  fulfillment: string;
  released_at: string | null;
  disputed: boolean;
  risk_approved: boolean;
  risk: { ip_country?: string; signals?: string[] };
  created_at: string;
};
type BookingQuote = {
  id: string;
  client_id: string;
  expert_id: string;
  status: string;
  expires_at: string;
  amount: string;
  currency: string;
  service_id: string;
  specialty_id: string;
  country: string;
  kind: string;
  end_at: string;
};
export async function initializePayments(pool: Pool) {
  await pool.query(`
 CREATE TABLE IF NOT EXISTS payment_notification_start(id boolean PRIMARY KEY DEFAULT true CHECK(id),since timestamptz NOT NULL DEFAULT now()); INSERT INTO payment_notification_start(id) VALUES(true) ON CONFLICT DO NOTHING;
 CREATE TABLE IF NOT EXISTS payment_notification_delivery(payment_id uuid PRIMARY KEY,delivered_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS payment_gateways(id uuid PRIMARY KEY,provider text NOT NULL,mode text NOT NULL,enabled boolean NOT NULL DEFAULT false,current boolean NOT NULL DEFAULT true,version int NOT NULL,credentials text NOT NULL,currencies jsonb NOT NULL,countries jsonb NOT NULL DEFAULT '[]',connection_status text NOT NULL DEFAULT 'NOT_TESTED',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(provider,version));
 CREATE UNIQUE INDEX IF NOT EXISTS current_gateway ON payment_gateways(provider) WHERE current;
 CREATE TABLE IF NOT EXISTS payments(id uuid PRIMARY KEY,account_id uuid NOT NULL,booking_id uuid,expert_id uuid,gateway_id uuid REFERENCES payment_gateways(id),provider text NOT NULL,amount numeric(30,0) NOT NULL CHECK(amount>0),fee numeric(30,0) NOT NULL CHECK(fee>=0 AND fee<=amount),currency text NOT NULL,decimals int NOT NULL,status text NOT NULL DEFAULT 'CREATED',reference text,capture_reference text,checkout jsonb NOT NULL DEFAULT '{}',network text,snapshot jsonb NOT NULL DEFAULT '{}',request_key uuid NOT NULL,request_data jsonb NOT NULL,fulfillment text NOT NULL DEFAULT 'PENDING',released_at timestamptz,disputed boolean NOT NULL DEFAULT false,last_checked timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(account_id,request_key));
 CREATE UNIQUE INDEX IF NOT EXISTS one_booking_payment ON payments(booking_id) WHERE booking_id IS NOT NULL AND status NOT IN ('FAILED','CANCELLED');
 CREATE UNIQUE INDEX IF NOT EXISTS provider_reference ON payments(gateway_id,reference) WHERE reference IS NOT NULL;
 CREATE INDEX IF NOT EXISTS payments_work ON payments(updated_at,status);
 CREATE TABLE IF NOT EXISTS payment_webhooks(gateway_id uuid NOT NULL,event_id text NOT NULL,reference text NOT NULL,event_type text NOT NULL,payload_hash text NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(gateway_id,event_id));
 CREATE TABLE IF NOT EXISTS payment_audit(id bigserial PRIMARY KEY,actor_id uuid,entity_id uuid,action text NOT NULL,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS commission_rules(id uuid PRIMARY KEY,expert_id uuid,specialty_id uuid,country text,service_kind text,basis_points int NOT NULL CHECK(basis_points BETWEEN 0 AND 10000),priority int NOT NULL DEFAULT 0,active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS finance_settings(id boolean PRIMARY KEY DEFAULT true CHECK(id),commission_bps int NOT NULL DEFAULT 2000 CHECK(commission_bps BETWEEN 0 AND 10000),release_hours int NOT NULL DEFAULT 24 CHECK(release_hours BETWEEN 0 AND 720),max_hourly_attempts int NOT NULL DEFAULT 20,max_topup_minor numeric(30,0) NOT NULL DEFAULT 1000000);
 INSERT INTO finance_settings(id) VALUES(true) ON CONFLICT DO NOTHING;
 CREATE TABLE IF NOT EXISTS payment_refunds(id uuid PRIMARY KEY,payment_id uuid UNIQUE NOT NULL REFERENCES payments(id),requester uuid NOT NULL,target text NOT NULL,status text NOT NULL DEFAULT 'REQUESTED',reason text NOT NULL,provider_reference text,funds_locked boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
 ALTER TABLE payments ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;
 ALTER TABLE payments ADD COLUMN IF NOT EXISTS tax numeric(30,0) NOT NULL DEFAULT 0;
 ALTER TABLE finance_settings ADD COLUMN IF NOT EXISTS tax_bps int NOT NULL DEFAULT 0 CHECK(tax_bps BETWEEN 0 AND 10000);
 CREATE TABLE IF NOT EXISTS reconciliation_issues(id uuid PRIMARY KEY,payment_id uuid,code text NOT NULL,status text NOT NULL DEFAULT 'OPEN',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(payment_id,code));
 `);
}
export async function gateway(pool: Pool | PoolClient, id: string): Promise<Gateway> {
  const g = (await pool.query('SELECT * FROM payment_gateways WHERE id=$1', [id])).rows[0];
  if (!g) throw new ServiceError(409, 'GATEWAY_NOT_CONFIGURED');
  return {
    ...g,
    credentials: z.record(z.string(), z.string()).parse(openJson(g.credentials, 'gateway:' + id)),
  };
}
async function audit(
  db: Pool | PoolClient,
  actor: string | null,
  id: string | null,
  action: string,
  details: Record<string, unknown> = {},
) {
  await db.query(
    'INSERT INTO payment_audit(actor_id,entity_id,action,details) VALUES($1,$2,$3,$4)',
    [actor, id, action, details],
  );
}
async function issue(db: Pool | PoolClient, id: string, code: string) {
  await db.query(
    'INSERT INTO reconciliation_issues(id,payment_id,code) VALUES($1,$2,$3) ON CONFLICT(payment_id,code) DO UPDATE SET updated_at=now()',
    [randomUUID(), id, code],
  );
}
async function wallet(p: Payment, action: string, key: string, external = false) {
  return internalCall('wallet-service', '/internal/wallet/execute', '', {
    key,
    reference: p.id,
    action,
    account_id: p.account_id,
    ...(p.expert_id ? { expert_id: p.expert_id } : {}),
    amount: p.amount,
    fee: p.fee,
    tax: p.tax ?? '0',
    currency: p.currency,
    external,
  });
}
const publicPayment = (p: Payment) => ({
  id: p.id,
  invoice_number: 'VN-' + p.id.toUpperCase(),
  tax: p.tax ?? '0',
  booking_id: p.booking_id,
  provider: p.provider,
  amount: p.amount,
  currency: p.currency,
  decimals: p.decimals,
  status: p.status,
  checkout: p.checkout,
  fulfillment: p.fulfillment,
  created_at: p.created_at,
});
async function getPayment(pool: Pool, id: string) {
  const p = (await pool.query('SELECT * FROM payments WHERE id=$1', [id])).rows[0] as
    | Payment
    | undefined;
  if (!p) throw new ServiceError(404, 'NOT_FOUND');
  return p;
}
async function authorizePayment(req: Parameters<typeof principal>[0], p: Payment) {
  const u = await principal(req);
  if (u.id !== p.account_id) await requirePermission(req, 'finance.read');
  return u;
}
async function fulfill(db: PoolClient, p: Payment) {
  if (p.fulfillment !== 'PENDING') return;
  if (!p.booking_id) {
    await wallet(p, 'TOPUP', 'fund:' + p.id);
    await db.query("UPDATE payments SET fulfillment='APPLIED' WHERE id=$1", [p.id]);
    return;
  }
  // The wallet debit and booking confirmation are idempotent; a failed hold is compensated to the customer's wallet.
  await wallet(p, p.provider === 'wallet' ? 'PURCHASE' : 'EXTERNAL_PURCHASE', 'fund:' + p.id);
  const result = await internalCall<{ status: string }>(
    'booking-service',
    '/internal/bookings/payment-confirm',
    '',
    {
      booking_id: p.booking_id,
      payment_id: p.id,
      account_id: p.account_id,
      amount: p.amount,
      currency: p.currency,
    },
  );
  if (!['CONFIRMED', 'RESCHEDULED', 'COMPLETED'].includes(result.status)) {
    await wallet(p, 'REFUND_PENDING', 'late:' + p.id);
    await db.query("UPDATE payments SET fulfillment='CREDITED_LATE' WHERE id=$1", [p.id]);
    await issue(db, p.id, 'LATE_PAYMENT_WALLET_CREDIT');
  } else await db.query("UPDATE payments SET fulfillment='APPLIED' WHERE id=$1", [p.id]);
}
export async function processPayment(pool: Pool, id: string) {
  const claimed = (
    await pool.query(
      "UPDATE payments SET status='CREATE_UNCERTAIN' WHERE id=$1 AND provider='nowpayments' AND status='CREATED' AND reference IS NULL RETURNING id",
      [id],
    )
  ).rowCount;
  return transaction(pool, async (db) => {
    const p = (await db.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [id])).rows[0] as
      | Payment
      | undefined;
    if (!p) throw new ServiceError(404, 'NOT_FOUND');
    if (p.status === 'RISK_REVIEW' && !p.risk_approved) return publicPayment(p);
    if (p.status === 'SUCCESS') {
      await fulfill(db, p);
      return publicPayment((await db.query('SELECT * FROM payments WHERE id=$1', [id])).rows[0]);
    }
    if (['REFUNDED', 'FAILED', 'CANCELLED'].includes(p.status)) return publicPayment(p);
    if (p.provider === 'wallet') {
      try {
        await wallet(p, 'PURCHASE', 'fund:' + p.id);
      } catch (error) {
        if (error instanceof ServiceError && error.code === 'INSUFFICIENT_BALANCE') {
          await db.query("UPDATE payments SET status='FAILED',updated_at=now() WHERE id=$1", [id]);
          return { ...publicPayment(p), status: 'FAILED' };
        }
        throw error;
      }
      p.status = 'SUCCESS';
      await db.query("UPDATE payments SET status='SUCCESS',updated_at=now() WHERE id=$1", [id]);
      await fulfill(db, p);
    } else {
      const g = await gateway(db, p.gateway_id!);
      if (!p.reference) {
        // NOWPayments has no documented idempotency guarantee. Persist its invoice once; uncertain creates require reconciliation, never blind retries.
        if (p.status === 'CREATE_UNCERTAIN' && !claimed) return publicPayment(p);
        const base = process.env.AUTH_PUBLIC_URL;
        if (!base) throw new ServiceError(503, 'NOT_CONFIGURED');
        const result = await createProviderPayment(g, {
          id: p.id,
          amount: p.amount,
          currency: p.currency,
          decimals: p.decimals,
          return_url:
            base + '/' + String(p.request_data.locale ?? 'en') + '/account/wallet?payment=' + p.id,
          callback_url: base + '/api/payment-webhooks/' + g.id,
          ...(p.network ? { network: p.network } : {}),
        });
        if (!result.reference) throw new ServiceError(502, 'PROVIDER_INVALID_RESPONSE');
        await db.query(
          "UPDATE payments SET reference=$2,checkout=$3,status='PENDING',updated_at=now() WHERE id=$1",
          [
            id,
            result.reference,
            {
              ...(result.checkout_url ? { url: result.checkout_url } : {}),
              ...(result.address
                ? { address: result.address, amount: result.crypto_amount, network: result.network }
                : {}),
            },
          ],
        );
        return publicPayment((await db.query('SELECT * FROM payments WHERE id=$1', [id])).rows[0]);
      }
      let result = await verifyProviderPayment(g, p.reference, p.decimals, false);
      if (result.payment_id && result.payment_id !== p.id) {
        await issue(db, id, 'PROVIDER_PAYMENT_MISMATCH');
        return publicPayment(p);
      }
      if (result.amount !== p.amount || result.currency !== p.currency) {
        await issue(db, id, 'AMOUNT_OR_CURRENCY_MISMATCH');
        await db.query('UPDATE payments SET last_checked=now() WHERE id=$1', [id]);
        return publicPayment(p);
      }
      const paymentCountry = result.card_country || result.country || p.risk?.ip_country;
      const mismatch = !!(
          result.card_country &&
          p.risk?.ip_country &&
          result.card_country !== p.risk.ip_country
        ),
        restricted = !!(
          g.countries?.length &&
          (!paymentCountry || !g.countries.includes(paymentCountry))
        );
      if ((mismatch || restricted) && !p.risk_approved) {
        await db.query('UPDATE payments SET risk_hold=true WHERE id=$1', [id]);
        await issue(db, id, mismatch ? 'COUNTRY_MISMATCH' : 'COUNTRY_RESTRICTED');
        if (result.state === 'AUTHORIZED') {
          await db.query(
            "UPDATE payments SET status='RISK_REVIEW',risk=risk||$2::jsonb WHERE id=$1",
            [
              id,
              JSON.stringify({
                card_country: result.card_country ?? null,
                billing_country: result.country ?? null,
              }),
            ],
          );
          return { ...publicPayment(p), status: 'RISK_REVIEW' };
        }
      }
      if (result.state === 'AUTHORIZED')
        result = await verifyProviderPayment(g, p.reference, p.decimals, true);
      if (result.amount !== p.amount || result.currency !== p.currency)
        throw new ServiceError(409, 'AMOUNT_OR_CURRENCY_MISMATCH');
      const status =
        result.state === 'SUCCESS'
          ? 'SUCCESS'
          : ['FAILED', 'CANCELLED'].includes(result.state)
            ? result.state
            : result.state;
      await db.query(
        'UPDATE payments SET status=$2,capture_reference=COALESCE($3,capture_reference),last_checked=now(),updated_at=now() WHERE id=$1',
        [id, status, result.capture_reference || null],
      );
      p.status = status;
      if (status === 'SUCCESS') await fulfill(db, p);
      if (status === 'PARTIAL') await issue(db, id, 'CRYPTO_PARTIAL_PAYMENT');
    }
    await audit(db, p.account_id, p.id, 'PAYMENT_RECONCILED', { status: p.status });
    return publicPayment((await db.query('SELECT * FROM payments WHERE id=$1', [id])).rows[0]);
  });
}
export async function processRefund(pool: Pool, id: string) {
  return transaction(pool, async (db) => {
    const f = (await db.query('SELECT * FROM payment_refunds WHERE id=$1 FOR UPDATE', [id]))
      .rows[0];
    if (!f) throw new ServiceError(404, 'NOT_FOUND');
    if (!['APPROVED', 'PROCESSING'].includes(f.status)) return f;
    const p = (await db.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [f.payment_id]))
      .rows[0] as Payment;
    if (p.status !== 'SUCCESS' && p.status !== 'REFUNDED')
      throw new ServiceError(409, 'PAYMENT_NOT_REFUNDABLE');
    if (p.booking_id)
      await internalCall('booking-service', '/internal/bookings/financial-cancel', '', {
        booking_id: p.booking_id,
        payment_id: p.id,
      });
    if (!f.funds_locked) {
      await wallet(
        p,
        !p.booking_id || p.fulfillment === 'CREDITED_LATE'
          ? 'REFUND_LOCK_TOPUP'
          : p.released_at
            ? 'REFUND_LOCK_AVAILABLE'
            : 'REFUND_LOCK_PENDING',
        'refund-lock:' + f.id,
      );
      await db.query(
        "UPDATE payment_refunds SET funds_locked=true,status='PROCESSING',updated_at=now() WHERE id=$1",
        [id],
      );
    }
    if (f.target === 'ORIGINAL' && p.provider !== 'wallet') {
      const g = await gateway(db, p.gateway_id!);
      const result = await refundProvider(
        g,
        p.capture_reference!,
        p.amount,
        p.currency,
        p.decimals,
        'refund-' + f.id,
        f.provider_reference ?? undefined,
      );
      await db.query(
        'UPDATE payment_refunds SET provider_reference=$2,updated_at=now() WHERE id=$1',
        [id, result.reference],
      );
      if (result.state !== 'COMPLETED') {
        await issue(db, p.id, 'REFUND_' + result.state);
        return { ...f, status: 'PROCESSING' };
      }
    }
    await wallet(
      p,
      'REFUND_SEND',
      'refund-send:' + f.id,
      f.target === 'ORIGINAL' && p.provider !== 'wallet',
    );
    await db.query("UPDATE payment_refunds SET status='COMPLETED',updated_at=now() WHERE id=$1", [
      id,
    ]);
    await db.query(
      "UPDATE payments SET status='REFUNDED',fulfillment='REFUNDED',updated_at=now() WHERE id=$1",
      [p.id],
    );
    await audit(db, f.requester, p.id, 'REFUND_COMPLETED', { target: f.target });
    return { ...f, status: 'COMPLETED' };
  });
}
export function paymentsRouter(pool: Pool) {
  const r = internalRouter('2mb');
  r.post(
    '/api/v2/finance/payments/:id/reference',
    endpoint(async (req, res) => {
      const u = await requirePermission(req, 'finance.manage'),
        id = uuid.parse(req.params.id),
        d = z
          .object({ reference: z.string().min(2).max(200) })
          .strict()
          .parse(req.body);
      await transaction(pool, async (db) => {
        const p = (await db.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [id]))
          .rows[0] as Payment | undefined;
        if (!p || p.reference || !p.gateway_id || p.status !== 'CREATE_UNCERTAIN')
          throw new ServiceError(409, 'INVALID_TRANSITION');
        const result = await verifyProviderPayment(
          await gateway(db, p.gateway_id),
          d.reference,
          p.decimals,
          false,
        );
        if (
          result.payment_id !== p.id ||
          result.amount !== p.amount ||
          result.currency !== p.currency
        )
          throw new ServiceError(409, 'PROVIDER_PAYMENT_MISMATCH');
        await db.query(
          "UPDATE payments SET reference=$2,status='PENDING',updated_at=now() WHERE id=$1",
          [id, d.reference],
        );
        await audit(db, u.id, id, 'PROVIDER_REFERENCE_RECONCILED');
      });
      res.json({ data: await processPayment(pool, id) });
    }),
  );
  r.post(
    '/api/v2/finance/payments/:id/approve-risk',
    endpoint(async (req, res) => {
      const u = await requirePermission(req, 'finance.manage'),
        id = uuid.parse(req.params.id);
      await pool.query(
        "UPDATE payments SET risk_approved=true,risk_hold=false,status=CASE WHEN status='RISK_REVIEW' THEN CASE WHEN reference IS NULL THEN 'CREATED' ELSE 'PENDING' END ELSE status END WHERE id=$1",
        [id],
      );
      await audit(pool, u.id, id, 'RISK_APPROVED');
      res.json({ data: await processPayment(pool, id) });
    }),
  );
  r.get(
    '/api/v2/payments/methods',
    endpoint(async (req, res) => {
      await principal(req);
      res.json({
        data: {
          methods: [
            { provider: 'wallet', enabled: true },
            ...(
              await pool.query(
                'SELECT id,provider,mode,enabled,currencies,countries,connection_status FROM payment_gateways WHERE current ORDER BY provider',
              )
            ).rows,
          ],
          networks: networkCodes,
        },
      });
    }),
  );
  r.get(
    '/api/v2/payments',
    endpoint(async (req, res) => {
      const u = await principal(req);
      res.json({
        data: (
          await pool.query(
            'SELECT * FROM payments WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100',
            [u.id],
          )
        ).rows.map(publicPayment),
      });
    }),
  );
  r.post(
    '/api/v2/payments/create',
    endpoint(async (req, res) => {
      const u = await principal(req),
        d = z
          .object({
            request_key: uuid,
            provider: z.enum(['wallet', 'stripe', 'paypal', 'nowpayments']),
            booking_id: uuid.optional(),
            amount: minor.optional(),
            currency: currency.optional(),
            network: z.string().max(30).optional(),
            locale: z
              .string()
              .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
              .max(40)
              .optional(),
          })
          .strict()
          .parse(req.body);
      const existing = (
        await pool.query('SELECT * FROM payments WHERE account_id=$1 AND request_key=$2', [
          u.id,
          d.request_key,
        ])
      ).rows[0];
      if (existing) {
        if (
          JSON.stringify(existing.request_data) !== JSON.stringify(JSON.parse(JSON.stringify(d)))
        ) {
          const old = existing.request_data;
          if (Object.keys({ ...old, ...d }).some((k) => old[k] !== d[k as keyof typeof d]))
            throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT');
        }
        res.json({ data: await processPayment(pool, existing.id) });
        return;
      }
      const settings = (await pool.query('SELECT * FROM finance_settings WHERE id')).rows[0];
      let quote: BookingQuote | undefined;
      if (d.booking_id)
        quote = await internalCall<BookingQuote>(
          'booking-service',
          '/internal/bookings/payment-quote/' + d.booking_id,
          req.get('authorization') ?? '',
        );
      if (
        quote &&
        (quote.client_id !== u.id ||
          !['HELD', 'BOOKING_PENDING_PAYMENT'].includes(quote.status) ||
          Date.parse(quote.expires_at) <= Date.now())
      ) {
        if (
          (
            await pool.query(
              "SELECT 1 FROM payments WHERE booking_id=$1 AND status NOT IN ('FAILED','CANCELLED')",
              [d.booking_id],
            )
          ).rowCount
        )
          throw new ServiceError(409, 'BOOKING_ALREADY_PAID');
        throw new ServiceError(409, 'HOLD_EXPIRED');
      }
      if (!quote && d.provider === 'wallet')
        throw new ServiceError(400, 'WALLET_TOPUP_NOT_ALLOWED');
      const amount = quote?.amount ?? d.amount,
        c = quote?.currency ?? d.currency;
      if (!amount || !c || BigInt(amount) <= 0n) throw new ServiceError(400, 'INVALID_AMOUNT');
      if (!quote && BigInt(amount) > BigInt(settings.max_topup_minor))
        throw new ServiceError(409, 'RISK_LIMIT');
      const currencies = await internalCall<{ code: string; decimals: number; active: boolean }[]>(
        'accounting-service',
        '/internal/accounting/currencies',
      );
      const unit = currencies.find((x) => x.code === c && x.active);
      if (!unit) throw new ServiceError(400, 'CURRENCY_UNAVAILABLE');
      let gatewayId: string | null = null;
      if (d.provider !== 'wallet') {
        const g = (
          await pool.query(
            "SELECT * FROM payment_gateways WHERE provider=$1 AND current AND enabled AND connection_status='CONNECTED'",
            [d.provider],
          )
        ).rows[0];
        if (!g || !g.currencies.includes(c)) throw new ServiceError(409, 'GATEWAY_NOT_CONFIGURED');
        gatewayId = g.id;
      }
      if (d.provider === 'nowpayments' && (!d.network || !networkCodes[d.network]))
        throw new ServiceError(400, 'NETWORK_REQUIRED');
      const rule = quote
        ? (
            await pool.query(
              'SELECT * FROM commission_rules WHERE active AND(expert_id IS NULL OR expert_id=$1) AND(specialty_id IS NULL OR specialty_id=$2) AND(country IS NULL OR country=$3) AND(service_kind IS NULL OR service_kind=$4) ORDER BY priority DESC,created_at DESC LIMIT 1',
              [quote.expert_id, quote.specialty_id || null, quote.country, quote.kind],
            )
          ).rows[0]
        : undefined;
      const bps = rule?.basis_points ?? settings.commission_bps,
        tax = quote
          ? (
              (BigInt(amount) * BigInt(settings.tax_bps)) /
              (10000n + BigInt(settings.tax_bps))
            ).toString()
          : '0',
        fee = quote ? (((BigInt(amount) - BigInt(tax)) * BigInt(bps)) / 10000n).toString() : '0';
      let id = randomUUID();
      const risk = await paymentRisk(
        pool,
        id,
        u.id,
        amount,
        c,
        req.get('x-finance-client-ip') ?? '',
      );
      await transaction(pool, async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['payer:' + u.id]);
        const replay = (
          await db.query(
            'SELECT id,request_data FROM payments WHERE account_id=$1 AND request_key=$2',
            [u.id, d.request_key],
          )
        ).rows[0];
        if (replay) {
          if (
            Object.keys({ ...replay.request_data, ...d }).some(
              (k) => replay.request_data[k] !== d[k as keyof typeof d],
            )
          )
            throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT');
          id = replay.id;
          return;
        }
        const attempts = (
          await db.query(
            "SELECT count(*)::int AS count FROM payments WHERE account_id=$1 AND created_at>now()-interval '1 hour'",
            [u.id],
          )
        ).rows[0].count;
        if (attempts >= settings.max_hourly_attempts) throw new ServiceError(409, 'RISK_LIMIT');
        if (d.booking_id) {
          await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            'booking-payment:' + d.booking_id,
          ]);
          if (
            (
              await db.query(
                "SELECT 1 FROM payments WHERE booking_id=$1 AND status NOT IN ('FAILED','CANCELLED')",
                [d.booking_id],
              )
            ).rowCount
          )
            throw new ServiceError(409, 'BOOKING_ALREADY_PAID');
        }
        await db.query(
          'INSERT INTO payments(id,account_id,booking_id,expert_id,gateway_id,provider,amount,fee,currency,decimals,network,snapshot,request_key,request_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
          [
            id,
            u.id,
            d.booking_id ?? null,
            quote?.expert_id ?? null,
            gatewayId,
            d.provider,
            amount,
            fee,
            c,
            unit.decimals,
            d.network ?? null,
            {
              commission_bps: bps,
              commission_rule: rule?.id ?? null,
              release_hours: settings.release_hours,
              tax_bps: settings.tax_bps,
              booking: quote ?? null,
            },
            d.request_key,
            d,
          ],
        );
        await db.query(
          "UPDATE payments SET tax=$2,risk=$3,sealed_ip=$4,status=CASE WHEN $5 THEN 'RISK_REVIEW' ELSE status END WHERE id=$1",
          [id, tax, risk.risk, risk.sealed_ip, risk.review],
        );
        await audit(db, u.id, id, 'PAYMENT_CREATED', { provider: d.provider });
      });
      res.status(201).json({ data: await processPayment(pool, id) });
    }),
  );
  r.get(
    '/api/v2/payments/:id',
    endpoint(async (req, res) => {
      const p = await getPayment(pool, uuid.parse(req.params.id));
      await authorizePayment(req, p);
      res.json({ data: publicPayment(p) });
    }),
  );
  r.post(
    '/api/v2/payments/:id/reconcile',
    endpoint(async (req, res) => {
      const p = await getPayment(pool, uuid.parse(req.params.id));
      await authorizePayment(req, p);
      res.json({ data: await processPayment(pool, p.id) });
    }),
  );
  r.post(
    '/api/v2/payments/:id/refund',
    endpoint(async (req, res) => {
      const p = await getPayment(pool, uuid.parse(req.params.id)),
        u = await authorizePayment(req, p),
        d = z
          .object({
            target: z.enum(['WALLET', 'ORIGINAL']),
            reason: z.enum(['CANCELLED', 'EXPERT_CANCELLED', 'DISPUTE', 'PAYMENT_ERROR', 'OTHER']),
          })
          .strict()
          .parse(req.body);
      if (p.status !== 'SUCCESS') throw new ServiceError(409, 'PAYMENT_NOT_REFUNDABLE');
      if (d.target === 'ORIGINAL' && p.provider === 'nowpayments')
        throw new ServiceError(409, 'CRYPTO_REFUND_REQUIRES_PAYOUT');
      const id = randomUUID();
      const f = (
        await pool.query(
          'INSERT INTO payment_refunds(id,payment_id,requester,target,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT(payment_id) DO UPDATE SET payment_id=EXCLUDED.payment_id RETURNING *',
          [id, p.id, u.id, d.target, d.reason],
        )
      ).rows[0];
      res.json({ data: f });
    }),
  );
  r.post(
    '/internal/payment/webhook',
    endpoint(async (req, res) => {
      const d = z
          .object({
            gateway_id: uuid,
            raw: z.string().max(1400000),
            headers: z.record(z.string(), z.string().max(4000)),
          })
          .strict()
          .parse(req.body),
        g = await gateway(pool, d.gateway_id),
        raw = Buffer.from(d.raw, 'base64').toString('utf8'),
        event = await verifyWebhook(g, raw, d.headers);
      if (!event.event_id || event.event_id.length > 300)
        throw new ServiceError(400, 'INVALID_EVENT');
      await pool.query(
        'INSERT INTO payment_webhooks(gateway_id,event_id,reference,event_type,payload_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [
          g.id,
          event.event_id,
          event.reference,
          event.type,
          createHash('sha256').update(raw).digest('hex'),
        ],
      );
      const p = (
        await pool.query(
          'SELECT id FROM payments WHERE gateway_id=$1 AND(reference=$2 OR capture_reference=$2)',
          [g.id, event.reference],
        )
      ).rows[0];
      if (p) await processPayment(pool, p.id);
      res.json({ data: { accepted: true } });
    }),
  );
  r.post(
    '/internal/payments/:id/dispute-refund',
    endpoint(async (req, res) => {
      const id = uuid.parse(req.params.id),
        d = z.object({ dispute_id: uuid }).strict().parse(req.body),
        p = await getPayment(pool, id);
      const f = (
        await pool.query(
          "INSERT INTO payment_refunds(id,payment_id,requester,target,reason,status) VALUES($1,$2,$3,'WALLET','DISPUTE','APPROVED') ON CONFLICT(payment_id) DO UPDATE SET status=CASE WHEN payment_refunds.status='REQUESTED' THEN 'APPROVED' ELSE payment_refunds.status END RETURNING id",
          [d.dispute_id, id, p.account_id],
        )
      ).rows[0];
      res.json({ data: await processRefund(pool, f.id) });
    }),
  );
  r.get(
    '/internal/payments/booking/:id',
    endpoint(async (req, res) => {
      const p = (
        await pool.query(
          "SELECT * FROM payments WHERE booking_id=$1 AND status IN ('SUCCESS','REFUNDED')",
          [uuid.parse(req.params.id)],
        )
      ).rows[0];
      res.json({
        data: p
          ? {
              id: p.id,
              account_id: p.account_id,
              expert_id: p.expert_id,
              status: p.status,
              amount: p.amount,
              currency: p.currency,
              released_at: p.released_at,
            }
          : null,
      });
    }),
  );
  r.post(
    '/internal/payments/:id/dispute',
    endpoint(async (req, res) => {
      const id = uuid.parse(req.params.id),
        d = z.object({ open: z.boolean() }).strict().parse(req.body);
      await pool.query('UPDATE payments SET disputed=$2 WHERE id=$1', [id, d.open]);
      res.json({ data: { ok: true } });
    }),
  );
  r.get(
    '/api/v2/finance/gateways',
    endpoint(async (req, res) => {
      await requirePermission(req, 'finance.manage');
      res.json({
        data: (
          await pool.query(
            'SELECT id,provider,mode,enabled,version,currencies,countries,connection_status FROM payment_gateways WHERE current ORDER BY provider',
          )
        ).rows,
      });
    }),
  );
  r.post(
    '/api/v2/finance/gateways',
    endpoint(async (req, res) => {
      const u = await requirePermission(req, 'finance.manage'),
        d = z
          .object({
            provider,
            mode: z.enum(['TEST', 'LIVE']),
            enabled: z.boolean(),
            currencies: z.array(currency).min(1).max(30),
            countries: z
              .array(z.string().regex(/^[A-Z]{2}$/))
              .max(250)
              .default([]),
            credentials: z.record(z.string(), z.string().max(4096)),
          })
          .strict()
          .parse(req.body);
      const required =
        d.provider === 'stripe'
          ? ['secret_key', 'webhook_secret']
          : d.provider === 'paypal'
            ? ['client_id', 'client_secret', 'webhook_id']
            : ['api_key', 'ipn_secret'];
      const old = (
        await pool.query('SELECT * FROM payment_gateways WHERE provider=$1 AND current', [
          d.provider,
        ])
      ).rows[0];
      const values = {
        ...(old ? (await gateway(pool, old.id)).credentials : {}),
        ...Object.fromEntries(Object.entries(d.credentials).filter(([, v]) => v)),
      };
      if (required.some((k) => !values[k])) throw new ServiceError(400, 'CREDENTIALS_REQUIRED');
      if (
        Object.keys(values).some(
          (k) =>
            !required.includes(k) &&
            !(d.provider === 'nowpayments' && ['payout_email', 'payout_password'].includes(k)),
        )
      )
        throw new ServiceError(400, 'INVALID_INPUT');
      const id = randomUUID();
      await transaction(pool, async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          'gateway:' + d.provider,
        ]);
        const previous = (
          await db.query(
            'SELECT COALESCE(max(version),0)::int AS v FROM payment_gateways WHERE provider=$1',
            [d.provider],
          )
        ).rows[0].v;
        await db.query(
          'UPDATE payment_gateways SET current=false,enabled=false WHERE provider=$1 AND current',
          [d.provider],
        );
        await db.query(
          'INSERT INTO payment_gateways(id,provider,mode,enabled,version,credentials,currencies,countries) VALUES($1,$2,$3,false,$4,$5,$6,$7)',
          [
            id,
            d.provider,
            d.mode,
            previous + 1,
            sealJson(values, 'gateway:' + id),
            JSON.stringify(d.currencies),
            JSON.stringify(d.countries),
          ],
        );
        await audit(db, u.id, id, 'GATEWAY_CONFIGURED', { provider: d.provider, mode: d.mode });
      });
      res.json({
        data: {
          id,
          webhook_url: process.env.AUTH_PUBLIC_URL + '/api/payment-webhooks/' + id,
          enabled: false,
        },
      });
    }),
  );
  r.post(
    '/api/v2/finance/gateways/:id/test',
    endpoint(async (req, res) => {
      const u = await requirePermission(req, 'finance.manage'),
        id = uuid.parse(req.params.id),
        result = await checkGateway(await gateway(pool, id));
      await pool.query('UPDATE payment_gateways SET connection_status=$2 WHERE id=$1', [
        id,
        result.charges_enabled ? 'CONNECTED' : 'RESTRICTED',
      ]);
      await audit(pool, u.id, id, 'GATEWAY_TESTED');
      res.json({ data: result });
    }),
  );
  r.post(
    '/api/v2/finance/gateways/:id/toggle',
    endpoint(async (req, res) => {
      const u = await requirePermission(req, 'finance.manage'),
        id = uuid.parse(req.params.id),
        d = z.object({ enabled: z.boolean() }).strict().parse(req.body);
      const g = (await pool.query('SELECT * FROM payment_gateways WHERE id=$1 AND current', [id]))
        .rows[0];
      if (!g || (d.enabled && g.connection_status !== 'CONNECTED'))
        throw new ServiceError(409, 'GATEWAY_NOT_READY');
      await pool.query('UPDATE payment_gateways SET enabled=$2 WHERE id=$1', [id, d.enabled]);
      await audit(pool, u.id, id, 'GATEWAY_TOGGLED', { enabled: d.enabled });
      res.json({ data: { ok: true } });
    }),
  );
  r.get(
    '/api/v2/finance/settings',
    endpoint(async (req, res) => {
      await requirePermission(req, 'finance.read');
      res.json({
        data: {
          settings: (await pool.query('SELECT * FROM finance_settings WHERE id')).rows[0],
          rules: (await pool.query('SELECT * FROM commission_rules ORDER BY priority DESC')).rows,
        },
      });
    }),
  );
  r.post(
    '/api/v2/finance/settings',
    endpoint(async (req, res) => {
      const u = await requirePermission(req, 'finance.manage'),
        d = z
          .object({
            commission_bps: z.number().int().min(0).max(10000),
            release_hours: z.number().int().min(0).max(720),
            max_hourly_attempts: z.number().int().min(1).max(100),
            max_topup_minor: minor,
            tax_bps: z.number().int().min(0).max(10000).default(0),
          })
          .strict()
          .parse(req.body);
      await pool.query(
        'UPDATE finance_settings SET commission_bps=$1,release_hours=$2,max_hourly_attempts=$3,max_topup_minor=$4,tax_bps=$5 WHERE id',
        [d.commission_bps, d.release_hours, d.max_hourly_attempts, d.max_topup_minor, d.tax_bps],
      );
      await audit(pool, u.id, null, 'SETTINGS_UPDATED');
      res.json({ data: d });
    }),
  );
  r.post(
    '/api/v2/finance/commissions',
    endpoint(async (req, res) => {
      await requirePermission(req, 'finance.manage');
      const d = z
        .object({
          expert_id: uuid.nullable().default(null),
          specialty_id: uuid.nullable().default(null),
          country: z
            .string()
            .regex(/^[A-Z]{2}$/)
            .nullable()
            .default(null),
          service_kind: z.string().max(60).nullable().default(null),
          basis_points: z.number().int().min(0).max(10000),
          priority: z.number().int().min(0).max(1000),
          active: z.boolean().default(true),
        })
        .strict()
        .parse(req.body);
      const id = randomUUID();
      await pool.query(
        'INSERT INTO commission_rules(id,expert_id,specialty_id,country,service_kind,basis_points,priority,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          id,
          d.expert_id,
          d.specialty_id,
          d.country,
          d.service_kind,
          d.basis_points,
          d.priority,
          d.active,
        ],
      );
      res.json({ data: { id } });
    }),
  );
  r.get(
    '/api/v2/finance/payments',
    endpoint(async (req, res) => {
      await requirePermission(req, 'finance.read');
      res.json({
        data: (
          await pool.query(
            'SELECT id,account_id,booking_id,provider,amount,fee,currency,status,fulfillment,reference,released_at,disputed,risk,risk_approved,risk_hold,created_at FROM payments ORDER BY created_at DESC LIMIT 200',
          )
        ).rows,
      });
    }),
  );
  r.post(
    '/api/v2/finance/refunds/:id/reject',
    endpoint(async (req, res) => {
      const u = await requirePermission(req, 'finance.manage'),
        id = uuid.parse(req.params.id);
      const r = await pool.query(
        "UPDATE payment_refunds SET status='REJECTED',updated_at=now() WHERE id=$1 AND status='REQUESTED' RETURNING id",
        [id],
      );
      if (!r.rowCount) throw new ServiceError(409, 'INVALID_TRANSITION');
      await audit(pool, u.id, id, 'REFUND_REJECTED');
      res.json({ data: { id } });
    }),
  );
  r.post(
    '/api/v2/finance/commissions/:id/toggle',
    endpoint(async (req, res) => {
      const u = await requirePermission(req, 'finance.manage'),
        id = uuid.parse(req.params.id),
        d = z.object({ active: z.boolean() }).strict().parse(req.body);
      await pool.query('UPDATE commission_rules SET active=$2 WHERE id=$1', [id, d.active]);
      await audit(pool, u.id, id, 'COMMISSION_TOGGLED', { active: d.active });
      res.json({ data: { id } });
    }),
  );
  r.get(
    '/api/v2/finance/refunds',
    endpoint(async (req, res) => {
      await requirePermission(req, 'finance.read');
      res.json({
        data: (await pool.query('SELECT * FROM payment_refunds ORDER BY created_at DESC LIMIT 200'))
          .rows,
      });
    }),
  );
  r.post(
    '/api/v2/finance/refunds/:id/approve',
    endpoint(async (req, res) => {
      const u = await requirePermission(req, 'finance.manage'),
        id = uuid.parse(req.params.id);
      await pool.query(
        "UPDATE payment_refunds SET status='APPROVED' WHERE id=$1 AND status='REQUESTED'",
        [id],
      );
      await audit(pool, u.id, id, 'REFUND_APPROVED');
      res.json({ data: await processRefund(pool, id) });
    }),
  );
  r.get(
    '/api/v2/finance/reconciliation',
    endpoint(async (req, res) => {
      await requirePermission(req, 'finance.read');
      res.json({
        data: {
          issues: (
            await pool.query(
              'SELECT * FROM reconciliation_issues ORDER BY created_at DESC LIMIT 200',
            )
          ).rows,
          unmatched_events: (
            await pool.query(
              'SELECT w.gateway_id,w.event_id,w.event_type,w.received_at FROM payment_webhooks w WHERE NOT EXISTS(SELECT 1 FROM payments p WHERE p.gateway_id=w.gateway_id AND(p.reference=w.reference OR p.capture_reference=w.reference)) ORDER BY received_at DESC LIMIT 100',
            )
          ).rows,
        },
      });
    }),
  );
  r.post(
    '/api/v2/finance/reconcile',
    endpoint(async (req, res) => {
      await requirePermission(req, 'finance.manage');
      res.json({ data: await financeTick(pool) });
    }),
  );
  r.get(
    '/api/v2/finance/reports',
    endpoint(async (req, res) => {
      await requirePermission(req, 'finance.read');
      const q = z
        .object({ period: z.enum(['day', 'month', 'year']).default('month') })
        .strict()
        .parse(req.query);
      res.json({
        data: (
          await pool.query(
            "SELECT date_trunc($1,created_at) AS period,currency,provider,COALESCE(risk->>'ip_country','UNKNOWN') AS country,count(*)::int AS count,sum(amount)::text AS gross,sum(fee)::text AS commission,sum(tax)::text AS tax,sum(CASE WHEN status='REFUNDED' THEN amount ELSE 0 END)::text AS refunds,sum(CASE WHEN released_at IS NOT NULL AND status='SUCCESS' THEN fee ELSE 0 END)::text AS net_revenue FROM payments WHERE status IN ('SUCCESS','REFUNDED') GROUP BY 1,currency,provider,4 ORDER BY 1 DESC LIMIT 200",
            [q.period],
          )
        ).rows,
      });
    }),
  );
  return r;
}
export async function financeTick(pool: Pool) {
  if (process.env.COMMUNICATIONS_ENABLED === '1') {
    for (const p of (
      await pool.query(
        "SELECT id,account_id FROM payments WHERE status='SUCCESS' AND created_at>=(SELECT since FROM payment_notification_start WHERE id) AND fulfillment IN ('APPLIED','CREDITED_LATE') AND NOT EXISTS(SELECT 1 FROM payment_notification_delivery d WHERE d.payment_id=payments.id) LIMIT 50",
      )
    ).rows) {
      try {
        await internalCall('notification-service', '/internal/notifications', '', {
          id: p.id,
          account_id: p.account_id,
          context_id: p.id,
          category: 'PAYMENTS',
          event: 'PAYMENT_COMPLETED',
        });
        await pool.query(
          'INSERT INTO payment_notification_delivery(payment_id) VALUES($1) ON CONFLICT DO NOTHING',
          [p.id],
        );
      } catch {
        /* Durable notification is retried after recovery. */
      }
    }
  }

  let checked = 0;
  for (const p of (
    await pool.query(
      "SELECT * FROM payments WHERE gateway_id IS NOT NULL AND reference IS NOT NULL AND status='SUCCESS' AND(reconciled_at IS NULL OR reconciled_at<now()-interval '1 day') ORDER BY reconciled_at NULLS FIRST LIMIT 30",
    )
  ).rows as Payment[]) {
    try {
      const result = await verifyProviderPayment(
        await gateway(pool, p.gateway_id!),
        p.reference!,
        p.decimals,
        false,
      );
      if (
        result.amount !== p.amount ||
        result.currency !== p.currency ||
        result.state !== 'SUCCESS'
      )
        await issue(pool, p.id, 'DAILY_PROVIDER_MISMATCH');
      await pool.query('UPDATE payments SET reconciled_at=now() WHERE id=$1', [p.id]);
    } catch {
      /* A failed daily provider read remains due for retry. */
    }
  }
  for (const p of (
    await pool.query(
      "SELECT id FROM payments WHERE(status NOT IN ('SUCCESS','REFUNDED','FAILED','CANCELLED','CREATE_UNCERTAIN') OR(status='SUCCESS' AND fulfillment='PENDING')) AND(last_checked IS NULL OR last_checked<now()-interval '30 seconds') ORDER BY updated_at LIMIT 30",
    )
  ).rows) {
    try {
      await processPayment(pool, p.id);
      checked++;
    } catch {
      await pool.query('UPDATE payments SET last_checked=now() WHERE id=$1', [p.id]);
    }
  }
  for (const f of (
    await pool.query(
      "SELECT id FROM payment_refunds WHERE status IN ('APPROVED','PROCESSING') ORDER BY updated_at LIMIT 20",
    )
  ).rows) {
    try {
      await processRefund(pool, f.id);
    } catch {
      /* Durable refund remains retryable without returning reserved money. */
    }
  }
  for (const p of (
    await pool.query(
      "SELECT id FROM payments WHERE booking_id IS NOT NULL AND status='SUCCESS' AND fulfillment='APPLIED' AND released_at IS NULL AND NOT disputed AND NOT risk_hold AND NOT EXISTS(SELECT 1 FROM payment_refunds f WHERE f.payment_id=payments.id) LIMIT 100",
    )
  ).rows) {
    try {
      await transaction(pool, async (db) => {
        const row = (await db.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [p.id]))
          .rows[0] as Payment;
        if (row.released_at || row.disputed) return;
        const dispute = await internalCall<{ open: boolean }>(
          'dispute-service',
          '/internal/disputes/payment/' + row.id,
        );
        if (dispute.open) return;
        const booking = await internalCall<{ status: string; end_at: string }>(
          'booking-service',
          '/internal/bookings/financial-state/' + row.booking_id,
        );
        if (booking.status === 'CANCELLED') {
          await db.query(
            "INSERT INTO payment_refunds(id,payment_id,requester,target,reason,status) VALUES($1,$2,$3,'WALLET','CANCELLED','APPROVED') ON CONFLICT(payment_id) DO NOTHING",
            [randomUUID(), row.id, row.account_id],
          );
          return;
        }
        if (
          booking.status !== 'COMPLETED' ||
          Date.parse(booking.end_at) + Number(row.snapshot.release_hours ?? 24) * 3600000 >
            Date.now()
        )
          return;
        await wallet(row, 'RELEASE', 'release:' + row.id);
        await db.query('UPDATE payments SET released_at=now() WHERE id=$1', [row.id]);
      });
    } catch {
      /* Retry escrow release after dependencies recover. */
    }
  }
  return { checked };
}
export function financeWorker(pool: Pool) {
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    void financeTick(pool)
      .catch(() => {})
      .finally(() => {
        busy = false;
      });
  };
  const timer = setInterval(tick, 30000);
  timer.unref();
}
