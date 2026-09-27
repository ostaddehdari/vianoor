import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Pool } from 'pg';
import {
  internalRouter,
  endpoint,
  principal,
  requirePermission,
  ServiceError,
  transaction,
} from '@vianoor/service-runtime';

export const minor = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
const currency = z.string().regex(/^[A-Z]{3,6}$/);
const kinds = z.enum([
  'AVAILABLE',
  'PENDING',
  'LOCKED',
  'PROVIDER',
  'HOLDING',
  'REVENUE',
  'TAX',
  'CLEARING',
  'REFUND',
]);
const line = z
  .object({
    owner: z.string().uuid().nullable(),
    kind: kinds,
    currency,
    debit: minor,
    credit: minor,
  })
  .strict();
export const journalInput = z
  .object({
    key: z.string().min(8).max(160),
    reference: z.string().uuid(),
    description: z.string().regex(/^[A-Z_]{2,60}$/),
    lines: z.array(line).min(2).max(24),
    metadata: z.record(z.string(), z.string().max(160)).default({}),
  })
  .strict();
export type JournalInput = z.infer<typeof journalInput>;
export function validateJournal(input: JournalInput) {
  const totals = new Map<string, bigint>();
  for (const l of input.lines) {
    const debit = BigInt(l.debit),
      credit = BigInt(l.credit);
    if ((debit === 0n) === (credit === 0n)) throw new ServiceError(400, 'INVALID_LEDGER_LINE');
    if (['AVAILABLE', 'PENDING', 'LOCKED'].includes(l.kind) && !l.owner)
      throw new ServiceError(400, 'OWNER_REQUIRED');
    totals.set(l.currency, (totals.get(l.currency) ?? 0n) + debit - credit);
  }
  if ([...totals.values()].some((x) => x !== 0n)) throw new ServiceError(400, 'UNBALANCED_JOURNAL');
}
export async function initializeLedger(pool: Pool) {
  await pool.query(`
 CREATE TABLE IF NOT EXISTS currencies(code text PRIMARY KEY,decimals smallint NOT NULL CHECK(decimals BETWEEN 0 AND 18),active boolean NOT NULL DEFAULT true);
 INSERT INTO currencies(code,decimals) VALUES('USD',2),('EUR',2),('GBP',2),('AED',2),('IRR',0),('IRT',0),('USDT',6),('USDC',6),('BTC',8),('ETH',18) ON CONFLICT DO NOTHING;
 CREATE TABLE IF NOT EXISTS ledger_accounts(id text PRIMARY KEY,owner_id uuid,kind text NOT NULL,currency text NOT NULL REFERENCES currencies(code),balance numeric(38,0) NOT NULL DEFAULT 0,CHECK(kind IN ('PROVIDER','CLEARING','REFUND') OR balance>=0));
 CREATE INDEX IF NOT EXISTS ledger_accounts_owner ON ledger_accounts(owner_id,currency);
 CREATE TABLE IF NOT EXISTS journals(id uuid PRIMARY KEY,idempotency_key text UNIQUE NOT NULL,fingerprint text NOT NULL,reference uuid NOT NULL,description text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',state text NOT NULL DEFAULT 'OPEN',created_at timestamptz NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS journals_reference ON journals(reference);
 CREATE TABLE IF NOT EXISTS ledger_entries(id bigserial PRIMARY KEY,journal_id uuid NOT NULL REFERENCES journals(id),account_id text NOT NULL REFERENCES ledger_accounts(id),currency text NOT NULL REFERENCES currencies(code),debit numeric(38,0) NOT NULL DEFAULT 0,credit numeric(38,0) NOT NULL DEFAULT 0,CHECK((debit>0 AND credit=0) OR(credit>0 AND debit=0)));
 CREATE INDEX IF NOT EXISTS ledger_entries_account ON ledger_entries(account_id,id);
 CREATE OR REPLACE FUNCTION ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='journals' AND TG_OP='UPDATE' AND to_jsonb(OLD)->>'state'='OPEN' AND to_jsonb(NEW)->>'state'='POSTED' AND (to_jsonb(OLD)-'state')=(to_jsonb(NEW)-'state') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'IMMUTABLE_LEDGER'; END $$;
 DROP TRIGGER IF EXISTS immutable_journals ON journals;
 CREATE TRIGGER immutable_journals BEFORE UPDATE OR DELETE ON journals FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
 DROP TRIGGER IF EXISTS immutable_entries ON ledger_entries;
 CREATE TRIGGER immutable_entries BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
 CREATE OR REPLACE FUNCTION ledger_open_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM journals WHERE id=NEW.journal_id AND state='OPEN') THEN RAISE EXCEPTION 'IMMUTABLE_LEDGER'; END IF; RETURN NEW; END $$;
 DROP TRIGGER IF EXISTS insert_open_only ON ledger_entries;
 CREATE TRIGGER insert_open_only BEFORE INSERT ON ledger_entries FOR EACH ROW EXECUTE FUNCTION ledger_open_only();
 CREATE OR REPLACE FUNCTION ledger_balanced() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM journals WHERE id=NEW.id AND state='POSTED') OR (SELECT count(*) FROM ledger_entries WHERE journal_id=NEW.id)<2 OR EXISTS(SELECT currency FROM ledger_entries WHERE journal_id=NEW.id GROUP BY currency HAVING sum(debit)<>sum(credit)) THEN RAISE EXCEPTION 'UNBALANCED_JOURNAL'; END IF; RETURN NULL; END $$;
 DROP TRIGGER IF EXISTS balanced_journal ON journals;
 CREATE CONSTRAINT TRIGGER balanced_journal AFTER INSERT OR UPDATE ON journals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_balanced();
 CREATE TABLE IF NOT EXISTS exchange_rates(id uuid PRIMARY KEY,base text NOT NULL REFERENCES currencies(code),quote text NOT NULL REFERENCES currencies(code),numerator numeric(38,0) NOT NULL CHECK(numerator>0),denominator numeric(38,0) NOT NULL CHECK(denominator>0),valid_until timestamptz NOT NULL,source text NOT NULL,actor uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),CHECK(base<>quote));
 CREATE TABLE IF NOT EXISTS fx_quotes(id uuid PRIMARY KEY,account_id uuid NOT NULL,rate_id uuid NOT NULL REFERENCES exchange_rates(id),base text NOT NULL,quote text NOT NULL,source_minor numeric(38,0) NOT NULL,target_minor numeric(38,0) NOT NULL,numerator numeric(38,0) NOT NULL,denominator numeric(38,0) NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 `);
}
export async function postJournal(pool: Pool, value: unknown) {
  const input = journalInput.parse(value);
  validateJournal(input);
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return transaction(pool, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [input.key]);
    const old = (
      await db.query('SELECT id,fingerprint FROM journals WHERE idempotency_key=$1', [input.key])
    ).rows[0];
    if (old) {
      if (old.fingerprint !== fingerprint) throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT');
      return { id: old.id, duplicate: true };
    }
    const balances = new Map<string, { line: z.infer<typeof line>; delta: bigint }>();
    for (const l of input.lines) {
      const id = [l.owner ?? 'platform', l.kind, l.currency].join(':');
      const b = balances.get(id);
      balances.set(id, { line: l, delta: (b?.delta ?? 0n) + BigInt(l.credit) - BigInt(l.debit) });
    }
    for (const [id, b] of [...balances.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const c = (
        await db.query('SELECT 1 FROM currencies WHERE code=$1 AND active', [b.line.currency])
      ).rowCount;
      if (!c) throw new ServiceError(400, 'CURRENCY_UNAVAILABLE');
      await db.query(
        'INSERT INTO ledger_accounts(id,owner_id,kind,currency) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [id, b.line.owner, b.line.kind, b.line.currency],
      );
      const account = (
        await db.query('SELECT balance FROM ledger_accounts WHERE id=$1 FOR UPDATE', [id])
      ).rows[0];
      if (
        !['PROVIDER', 'CLEARING', 'REFUND'].includes(b.line.kind) &&
        BigInt(account.balance) + b.delta < 0n
      )
        throw new ServiceError(409, 'INSUFFICIENT_BALANCE');
      await db.query('UPDATE ledger_accounts SET balance=balance+$2::numeric WHERE id=$1', [
        id,
        b.delta.toString(),
      ]);
    }
    const id = randomUUID();
    await db.query(
      'INSERT INTO journals(id,idempotency_key,fingerprint,reference,description,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [id, input.key, fingerprint, input.reference, input.description, input.metadata],
    );
    for (const l of input.lines)
      await db.query(
        'INSERT INTO ledger_entries(journal_id,account_id,currency,debit,credit) VALUES($1,$2,$3,$4,$5)',
        [id, [l.owner ?? 'platform', l.kind, l.currency].join(':'), l.currency, l.debit, l.credit],
      );
    await db.query("UPDATE journals SET state='POSTED' WHERE id=$1", [id]);
    return { id, duplicate: false };
  });
}
export function ledgerRouter(pool: Pool) {
  const r = internalRouter();
  r.get(
    '/internal/accounting/currencies',
    endpoint(async (_req, res) =>
      res.json({ data: (await pool.query('SELECT * FROM currencies ORDER BY code')).rows }),
    ),
  );
  r.post(
    '/internal/accounting/post',
    endpoint(async (req, res) => res.json({ data: await postJournal(pool, req.body) })),
  );
  r.get(
    '/internal/accounting/balances/:owner',
    endpoint(async (req, res) => {
      const owner = z.string().uuid().parse(req.params.owner);
      res.json({
        data: (
          await pool.query(
            'SELECT currency,kind,balance::text FROM ledger_accounts WHERE owner_id=$1 ORDER BY currency,kind',
            [owner],
          )
        ).rows,
      });
    }),
  );
  r.get(
    '/internal/accounting/history/:owner',
    endpoint(async (req, res) => {
      const owner = z.string().uuid().parse(req.params.owner);
      res.json({
        data: (
          await pool.query(
            'SELECT j.id,j.reference,j.description,j.created_at,a.kind,a.currency,e.debit::text,e.credit::text FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id JOIN journals j ON j.id=e.journal_id WHERE a.owner_id=$1 ORDER BY e.id DESC LIMIT 200',
            [owner],
          )
        ).rows,
      });
    }),
  );
  r.get(
    '/api/v2/accounting/currencies',
    endpoint(async (req, res) => {
      await principal(req);
      res.json({ data: (await pool.query('SELECT * FROM currencies ORDER BY code')).rows });
    }),
  );
  r.get(
    '/api/v2/accounting/ledger',
    endpoint(async (req, res) => {
      await requirePermission(req, 'finance.read');
      const offset = z.coerce.number().int().min(0).max(1000000).default(0).parse(req.query.offset);
      res.json({
        data: (
          await pool.query(
            "SELECT j.*, (SELECT jsonb_agg(jsonb_build_object('account',e.account_id,'currency',e.currency,'debit',e.debit::text,'credit',e.credit::text)) FROM ledger_entries e WHERE e.journal_id=j.id) AS lines FROM journals j ORDER BY created_at DESC,id LIMIT 100 OFFSET $1",
            [offset],
          )
        ).rows,
      });
    }),
  );
  r.get(
    '/api/v2/accounting/trial-balance',
    endpoint(async (req, res) => {
      await requirePermission(req, 'finance.read');
      res.json({
        data: (
          await pool.query(
            'SELECT currency,sum(debit)::text AS debit,sum(credit)::text AS credit FROM ledger_entries GROUP BY currency ORDER BY currency',
          )
        ).rows,
      });
    }),
  );
  r.get(
    '/api/v2/accounting/rates',
    endpoint(async (req, res) => {
      await principal(req);
      res.json({
        data: (await pool.query('SELECT * FROM exchange_rates ORDER BY created_at DESC LIMIT 100'))
          .rows,
      });
    }),
  );
  r.post(
    '/api/v2/accounting/rates',
    endpoint(async (req, res) => {
      const actor = await requirePermission(req, 'finance.manage');
      const d = z
        .object({
          base: currency,
          quote: currency,
          numerator: minor,
          denominator: minor,
          valid_until: z.string().datetime(),
          source: z.string().min(2).max(100),
        })
        .strict()
        .parse(req.body);
      if (
        d.base === d.quote ||
        BigInt(d.numerator) === 0n ||
        BigInt(d.denominator) === 0n ||
        Date.parse(d.valid_until) <= Date.now()
      )
        throw new ServiceError(400, 'INVALID_RATE');
      const id = randomUUID();
      await pool.query(
        'INSERT INTO exchange_rates(id,base,quote,numerator,denominator,valid_until,source,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [id, d.base, d.quote, d.numerator, d.denominator, d.valid_until, d.source, actor.id],
      );
      res.json({ data: { id } });
    }),
  );
  r.post(
    '/api/v2/accounting/quotes',
    endpoint(async (req, res) => {
      const u = await principal(req);
      const d = z
        .object({ base: currency, quote: currency, amount: minor })
        .strict()
        .parse(req.body);
      const rate = (
        await pool.query(
          'SELECT r.*,b.decimals AS bd,q.decimals AS qd FROM exchange_rates r JOIN currencies b ON b.code=r.base AND b.active JOIN currencies q ON q.code=r.quote AND q.active WHERE base=$1 AND quote=$2 AND valid_until>now() ORDER BY r.created_at DESC LIMIT 1',
          [d.base, d.quote],
        )
      ).rows[0];
      if (!rate) throw new ServiceError(409, 'RATE_UNAVAILABLE');
      const n = BigInt(rate.numerator) * 10n ** BigInt(rate.qd),
        den = BigInt(rate.denominator) * 10n ** BigInt(rate.bd),
        target = (BigInt(d.amount) * n) / den;
      if (target <= 0n) throw new ServiceError(400, 'AMOUNT_TOO_SMALL');
      const id = randomUUID();
      res.json({
        data: (
          await pool.query(
            "INSERT INTO fx_quotes(id,account_id,rate_id,base,quote,source_minor,target_minor,numerator,denominator,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,LEAST($10::timestamptz,now()+interval '2 minutes')) RETURNING *",
            [
              id,
              u.id,
              rate.id,
              d.base,
              d.quote,
              d.amount,
              target.toString(),
              n.toString(),
              den.toString(),
              rate.valid_until,
            ],
          )
        ).rows[0],
      });
    }),
  );
  r.get(
    '/internal/accounting/quotes/:id',
    endpoint(async (req, res) => {
      const id = z.string().uuid().parse(req.params.id);
      const q = (await pool.query('SELECT * FROM fx_quotes WHERE id=$1', [id])).rows[0];
      if (!q) throw new ServiceError(404, 'NOT_FOUND');
      res.json({ data: q });
    }),
  );
  return r;
}
