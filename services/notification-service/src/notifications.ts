import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  internalRouter,
  endpoint,
  principal,
  requirePermission,
  internalCall,
  ServiceError,
  transaction,
  type connectInfrastructure,
} from '@vianoor/service-runtime';
import { smsSettings, settings, seal, open, twilio, verifyPhone } from './sms.js';
const uuid = z.string().uuid(),
  categories = z.enum(['BOOKINGS', 'MESSAGES', 'PAYMENTS', 'MARKETING']);
const preference = z.object({ email: z.boolean(), sms: z.boolean() }).strict();
const preferences = z
  .object({
    BOOKINGS: preference,
    MESSAGES: preference,
    PAYMENTS: preference,
    MARKETING: preference,
  })
  .strict();
const defaults = {
  BOOKINGS: { email: true, sms: false },
  MESSAGES: { email: true, sms: false },
  PAYMENTS: { email: true, sms: false },
  MARKETING: { email: false, sms: false },
};
export async function initializeNotifications(pool: Pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS notifications(id uuid PRIMARY KEY,account_id uuid NOT NULL,category text NOT NULL,event text NOT NULL,context_id uuid NOT NULL,read_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());CREATE INDEX IF NOT EXISTS notifications_account ON notifications(account_id,created_at DESC);CREATE TABLE IF NOT EXISTS notification_preferences(account_id uuid PRIMARY KEY,preferences jsonb NOT NULL,locale text NOT NULL DEFAULT 'fa',sealed_phone text,phone_verified_at timestamptz);CREATE TABLE IF NOT EXISTS notification_jobs(id uuid PRIMARY KEY,notification_id uuid NOT NULL REFERENCES notifications(id),channel text NOT NULL,status text NOT NULL DEFAULT 'PENDING',attempts int NOT NULL DEFAULT 0,next_attempt timestamptz NOT NULL DEFAULT now(),provider_reference text,UNIQUE(notification_id,channel));CREATE TABLE IF NOT EXISTS notification_settings(id boolean PRIMARY KEY DEFAULT true CHECK(id),enabled boolean NOT NULL DEFAULT false,sealed_sms text);INSERT INTO notification_settings(id) VALUES(true) ON CONFLICT DO NOTHING;CREATE TABLE IF NOT EXISTS notification_audit(id bigserial PRIMARY KEY,actor_id uuid NOT NULL,action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());`,
  );
}
export async function queueNotification(pool: Pool, raw: unknown) {
  const d = z
    .object({
      id: uuid,
      account_id: uuid,
      context_id: uuid,
      category: categories,
      event: z.string().regex(/^[A-Z_0-9]{3,60}$/),
    })
    .strict()
    .parse(raw);
  return transaction(pool, async (db) => {
    const inserted = await db.query(
      'INSERT INTO notifications(id,account_id,category,event,context_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id',
      [d.id, d.account_id, d.category, d.event, d.context_id],
    );
    if (!inserted.rowCount) {
      const prior = (await db.query('SELECT * FROM notifications WHERE id=$1', [d.id])).rows[0];
      if (
        prior.account_id !== d.account_id ||
        prior.context_id !== d.context_id ||
        prior.event !== d.event ||
        prior.category !== d.category
      )
        throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT');
      return { ok: true };
    }
    const pref =
      (
        await db.query('SELECT preferences FROM notification_preferences WHERE account_id=$1', [
          d.account_id,
        ])
      ).rows[0]?.preferences ?? defaults;
    for (const channel of ['email', 'sms'] as const)
      if (pref[d.category]?.[channel])
        await db.query(
          'INSERT INTO notification_jobs(id,notification_id,channel) VALUES($1,$2,$3)',
          [randomUUID(), d.id, channel.toUpperCase()],
        );
    return { ok: true };
  });
}
export function notificationRouter(infra: Awaited<ReturnType<typeof connectInfrastructure>>) {
  const pool = infra.pool!,
    r = internalRouter();
  r.post(
    '/internal/notifications',
    endpoint(async (req, res) => {
      res.json({ data: await queueNotification(pool, req.body) });
      const d = req.body as { account_id: string; context_id: string };
      void internalCall('messaging-service', '/internal/communications/publish', '', {
        accounts: [d.account_id],
        event: { type: 'notification', context_id: d.context_id },
      }).catch(() => {});
    }),
  );
  r.get(
    '/api/v2/notifications',
    endpoint(async (req, res) => {
      const u = await principal(req);
      res.json({
        data: {
          items: (
            await pool.query(
              'SELECT id,category,event,context_id,read_at,created_at FROM notifications WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100',
              [u.id],
            )
          ).rows,
          unread: (
            await pool.query(
              'SELECT count(*)::int AS n FROM notifications WHERE account_id=$1 AND read_at IS NULL',
              [u.id],
            )
          ).rows[0].n,
        },
      });
    }),
  );
  r.post(
    '/api/v2/notifications/read',
    endpoint(async (req, res) => {
      const u = await principal(req),
        d = z
          .object({ ids: z.array(uuid).min(1).max(100) })
          .strict()
          .parse(req.body);
      await pool.query(
        'UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE account_id=$1 AND id=ANY($2::uuid[])',
        [u.id, d.ids],
      );
      res.json({ data: { ok: true } });
    }),
  );
  r.get(
    '/api/v2/notifications/preferences',
    endpoint(async (req, res) => {
      const u = await principal(req),
        p = (
          await pool.query(
            'SELECT preferences,locale,sealed_phone,phone_verified_at FROM notification_preferences WHERE account_id=$1',
            [u.id],
          )
        ).rows[0],
        sms = (await pool.query('SELECT enabled FROM notification_settings WHERE id')).rows[0];
      res.json({
        data: {
          preferences: p?.preferences ?? defaults,
          locale: p?.locale ?? 'fa',
          phone_verified: !!p?.phone_verified_at,
          phone_suffix: p?.sealed_phone ? String(open(p.sealed_phone, u.id)).slice(-4) : '',
          sms_available: sms.enabled,
        },
      });
    }),
  );
  r.post(
    '/api/v2/notifications/preferences',
    endpoint(async (req, res) => {
      const u = await principal(req),
        d = z
          .object({ preferences, locale: z.enum(['fa', 'en']) })
          .strict()
          .parse(req.body);
      if (
        Object.values(d.preferences).some((x) => x.sms) &&
        !(
          await pool.query(
            'SELECT 1 FROM notification_preferences WHERE account_id=$1 AND phone_verified_at IS NOT NULL',
            [u.id],
          )
        ).rowCount
      )
        throw new ServiceError(409, 'PHONE_NOT_VERIFIED');
      await pool.query(
        'INSERT INTO notification_preferences(account_id,preferences,locale) VALUES($1,$2,$3) ON CONFLICT(account_id) DO UPDATE SET preferences=EXCLUDED.preferences,locale=EXCLUDED.locale',
        [u.id, JSON.stringify(d.preferences), d.locale],
      );
      res.json({ data: { ok: true } });
    }),
  );
  r.post(
    '/api/v2/notifications/phone',
    endpoint(async (req, res) => {
      const u = await principal(req),
        d = z
          .object({
            phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
            code: z
              .string()
              .regex(/^\d{4,10}$/)
              .optional(),
          })
          .strict()
          .parse(req.body),
        rate = 'notification:phone:' + u.id;
      const count = await infra.redis.incr(rate);
      if (count === 1) await infra.redis.expire(rate, 900);
      if (count > 8) throw new ServiceError(429, 'VERIFICATION_LIMIT');
      if (!d.code) {
        await verifyPhone(pool, d.phone);
        await infra.redis.set(
          'notification:pending-phone:' + u.id,
          seal(d.phone, u.id + ':pending'),
          { EX: 600 },
        );
        res.json({ data: { sent: true } });
        return;
      }
      const pending = await infra.redis.get('notification:pending-phone:' + u.id);
      if (!pending || open(pending, u.id + ':pending') !== d.phone)
        throw new ServiceError(400, 'INVALID_VERIFICATION');
      await verifyPhone(pool, d.phone, d.code);
      await infra.redis.del('notification:pending-phone:' + u.id);
      await pool.query(
        'INSERT INTO notification_preferences(account_id,preferences,sealed_phone,phone_verified_at) VALUES($1,$2,$3,now()) ON CONFLICT(account_id) DO UPDATE SET sealed_phone=EXCLUDED.sealed_phone,phone_verified_at=now()',
        [u.id, JSON.stringify(defaults), seal(d.phone, u.id)],
      );
      res.json({ data: { verified: true } });
    }),
  );
  r.get(
    '/api/v2/notifications/admin',
    endpoint(async (req, res) => {
      await requirePermission(req, 'notification.manage');
      res.json({
        data: {
          settings: (
            await pool.query(
              'SELECT enabled,sealed_sms IS NOT NULL AS configured FROM notification_settings WHERE id',
            )
          ).rows[0],
          jobs: (
            await pool.query(
              'SELECT channel,status,count(*)::int AS count FROM notification_jobs GROUP BY channel,status',
            )
          ).rows,
        },
      });
    }),
  );
  r.post(
    '/api/v2/notifications/admin/sms',
    endpoint(async (req, res) => {
      const u = await requirePermission(req, 'notification.manage'),
        d = z
          .object({ enabled: z.boolean(), credentials: smsSettings.optional() })
          .strict()
          .parse(req.body);
      if (d.credentials) {
        await twilio(
          d.credentials,
          'api',
          '/2010-04-01/Accounts/' + d.credentials.account_sid + '.json',
        );
        await pool.query('UPDATE notification_settings SET sealed_sms=$1,enabled=$2 WHERE id', [
          seal(d.credentials, 'sms'),
          d.enabled,
        ]);
      } else {
        if (
          d.enabled &&
          !(
            await pool.query(
              'SELECT 1 FROM notification_settings WHERE id AND sealed_sms IS NOT NULL',
            )
          ).rowCount
        )
          throw new ServiceError(409, 'SMS_NOT_CONFIGURED');
        await pool.query('UPDATE notification_settings SET enabled=$1 WHERE id', [d.enabled]);
      }
      await pool.query(
        "INSERT INTO notification_audit(actor_id,action) VALUES($1,'SMS_SETTINGS_UPDATED')",
        [u.id],
      );
      res.json({ data: { ok: true } });
    }),
  );
  return r;
}
export async function deliverNotifications(pool: Pool) {
  for (const job of (
    await pool.query(
      "SELECT j.*,n.account_id,n.category,n.event,n.context_id FROM notification_jobs j JOIN notifications n ON n.id=j.notification_id WHERE j.status='PENDING' AND j.next_attempt<=now() ORDER BY j.next_attempt LIMIT 30",
    )
  ).rows) {
    try {
      const pref = (
        await pool.query('SELECT * FROM notification_preferences WHERE account_id=$1', [
          job.account_id,
        ])
      ).rows[0];
      if (!(pref?.preferences ?? defaults)[job.category]?.[String(job.channel).toLowerCase()]) {
        await pool.query("UPDATE notification_jobs SET status='DISABLED' WHERE id=$1", [job.id]);
        continue;
      }
      if (job.channel === 'EMAIL') {
        await internalCall('identity-service', '/internal/communication-email', '', {
          id: job.id,
          account_id: job.account_id,
          category: job.category,
          event: job.event,
          locale: pref?.locale ?? 'fa',
        });
        await pool.query("UPDATE notification_jobs SET status='QUEUED' WHERE id=$1", [job.id]);
      } else {
        if (!pref?.phone_verified_at) {
          await pool.query("UPDATE notification_jobs SET status='DISABLED' WHERE id=$1", [job.id]);
          continue;
        }
        const c = await settings(pool);
        const claimed = (
          await pool.query(
            "UPDATE notification_jobs SET status='SENDING' WHERE id=$1 AND status='PENDING' RETURNING id",
            [job.id],
          )
        ).rowCount;
        if (!claimed) continue;
        try {
          const sent = await twilio(
            c,
            'api',
            '/2010-04-01/Accounts/' + c.account_sid + '/Messages.json',
            {
              To: String(open(pref.sealed_phone, job.account_id)),
              MessagingServiceSid: c.messaging_service_sid,
              Body:
                pref.locale === 'fa'
                  ? 'ویانور: اعلان جدیدی در حساب شما ثبت شد.'
                  : 'Vianoor: You have a new account notification.',
            },
          );
          if (!sent.sid) throw new Error('Missing message reference');
          await pool.query(
            "UPDATE notification_jobs SET status='QUEUED',provider_reference=$2 WHERE id=$1",
            [job.id, sent.sid],
          );
        } catch {
          await pool.query("UPDATE notification_jobs SET status='UNKNOWN' WHERE id=$1", [job.id]);
        }
      }
    } catch {
      await pool.query(
        "UPDATE notification_jobs SET attempts=attempts+1,status=CASE WHEN attempts>=9 THEN 'FAILED' ELSE status END,next_attempt=now()+interval '1 minute' WHERE id=$1",
        [job.id],
      );
    }
  }
  for (const j of (
    await pool.query(
      "SELECT id,provider_reference FROM notification_jobs WHERE channel='SMS' AND status='QUEUED' AND provider_reference IS NOT NULL LIMIT 20",
    )
  ).rows) {
    try {
      const c = await settings(pool),
        s = await twilio(
          c,
          'api',
          '/2010-04-01/Accounts/' +
            c.account_sid +
            '/Messages/' +
            encodeURIComponent(j.provider_reference) +
            '.json',
        );
      if (['delivered', 'failed', 'undelivered'].includes(s.status ?? ''))
        await pool.query('UPDATE notification_jobs SET status=$2 WHERE id=$1', [
          j.id,
          s.status === 'delivered' ? 'DELIVERED' : 'FAILED',
        ]);
    } catch {
      /* Query provider later; never resend an ambiguous SMS. */
    }
  }
}
