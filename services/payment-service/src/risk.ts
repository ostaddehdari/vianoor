import { isIP } from 'node:net';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  internalRouter,
  endpoint,
  requirePermission,
  sealJson,
  openJson,
} from '@vianoor/service-runtime';
export async function initializeRisk(pool: Pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS financial_risk_config(id boolean PRIMARY KEY DEFAULT true CHECK(id),ipinfo_token text,review_spikes boolean NOT NULL DEFAULT true);INSERT INTO financial_risk_config(id) VALUES(true) ON CONFLICT DO NOTHING;ALTER TABLE payments ADD COLUMN IF NOT EXISTS risk jsonb NOT NULL DEFAULT '{}';ALTER TABLE payments ADD COLUMN IF NOT EXISTS sealed_ip text;ALTER TABLE payments ADD COLUMN IF NOT EXISTS risk_approved boolean NOT NULL DEFAULT false;ALTER TABLE payments ADD COLUMN IF NOT EXISTS risk_hold boolean NOT NULL DEFAULT false;`,
  );
}
export async function paymentRisk(
  pool: Pool,
  id: string,
  account: string,
  amount: string,
  currency: string,
  ip: string,
) {
  const config = (await pool.query('SELECT * FROM financial_risk_config WHERE id')).rows[0],
    signals: string[] = [];
  let country = '';
  if (isIP(ip) && config.ipinfo_token) {
    try {
      const token = z.string().parse(openJson(config.ipinfo_token, 'risk:ipinfo'));
      const response = await fetch(
        'https://ipinfo.io/' +
          encodeURIComponent(ip) +
          '/country?token=' +
          encodeURIComponent(token),
        { redirect: 'error', signal: AbortSignal.timeout(4000) },
      );
      const value = (await response.text()).trim();
      if (response.ok && /^[A-Z]{2}$/.test(value)) country = value;
    } catch {
      /* Missing country data is explicit, never guessed. */
    }
  }
  const recent = (
    await pool.query(
      "SELECT amount::text FROM payments WHERE account_id=$1 AND currency=$2 AND status='SUCCESS' ORDER BY created_at DESC LIMIT 10",
      [account, currency],
    )
  ).rows;
  if (recent.length >= 3) {
    const sum = recent.reduce((n, r) => n + BigInt(r.amount), 0n);
    if (BigInt(amount) * BigInt(recent.length) > sum * 5n) signals.push('AMOUNT_SPIKE');
  }
  if (!country) signals.push('IP_COUNTRY_UNKNOWN');
  return {
    risk: { ip_country: country || null, signals },
    sealed_ip: isIP(ip) ? sealJson(ip, 'payment-ip:' + id) : null,
    review: config.review_spikes && signals.includes('AMOUNT_SPIKE'),
  };
}
export function riskRouter(pool: Pool) {
  const r = internalRouter();
  r.get(
    '/api/v2/finance/risk',
    endpoint(async (req, res) => {
      await requirePermission(req, 'finance.manage');
      const c = (
        await pool.query(
          'SELECT review_spikes,ipinfo_token IS NOT NULL AS ipinfo_configured FROM financial_risk_config WHERE id',
        )
      ).rows[0];
      res.json({ data: c });
    }),
  );
  r.post(
    '/api/v2/finance/risk',
    endpoint(async (req, res) => {
      const u = await requirePermission(req, 'finance.manage'),
        d = z
          .object({ review_spikes: z.boolean(), ipinfo_token: z.string().max(500).optional() })
          .strict()
          .parse(req.body);
      await pool.query(
        'UPDATE financial_risk_config SET review_spikes=$1,ipinfo_token=CASE WHEN $2::text IS NULL THEN ipinfo_token ELSE $2 END WHERE id',
        [d.review_spikes, d.ipinfo_token ? sealJson(d.ipinfo_token, 'risk:ipinfo') : null],
      );
      await pool.query(
        "INSERT INTO payment_audit(actor_id,action) VALUES($1,'RISK_CONFIG_UPDATED')",
        [u.id],
      );
      res.json({ data: { ok: true } });
    }),
  );
  return r;
}
