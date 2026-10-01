import { randomUUID } from 'node:crypto';
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
} from '@vianoor/service-runtime';
const code = z.string().regex(/^[A-Za-z0-9]{13}$/),
  utc = z
    .string()
    .datetime({ offset: true })
    .transform((s) => new Date(s).toISOString());
const timezone = z
  .string()
  .max(80)
  .refine((s) => {
    try {
      return (s === 'UTC' || s.includes('/')) && !!new Intl.DateTimeFormat('en', { timeZone: s });
    } catch {
      return false;
    }
  });
type Snapshot = {
  expert_id: string;
  expert_code: string;
  expert_name: string;
  specialty_id?: string;
  country?: string;
  kind?: string;
  call_policy?: unknown;
  title: string;
  duration_minutes: number;
  price_minor: number;
  currency: string;
  cancellation_hours: number;
  expert_timezone: string;
  penalty_minor: number;
  refund_mode: string;
};
type Booking = {
  id: string;
  client_id: string;
  client_code: string;
  expert_code: string;
  service_id: string;
  start_at: string;
  end_at: string | null;
  status: string;
  expires_at: string | null;
  timezone: string;
  pending_action: string | null;
  operation_id: string;
  operation_actor?: string;
  action_data: { start_at?: string; previous_status?: string; intent?: string };
  snapshot: Snapshot | null;
  revision: number;
  error_code: string | null;
};
type Claim = {
  state: string;
  start_at: string;
  end_at: string;
  expires_at: string;
  snapshot: Snapshot;
};
export async function initializeScheduling(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS scheduled_bookings(id uuid PRIMARY KEY,client_id uuid NOT NULL,client_code varchar(13) NOT NULL,expert_code varchar(13) NOT NULL,service_id uuid NOT NULL,start_at timestamptz NOT NULL,end_at timestamptz,status text NOT NULL DEFAULT 'REQUESTED',expires_at timestamptz,timezone text NOT NULL,request_key uuid NOT NULL,request_data jsonb NOT NULL,pending_action text,operation_id uuid NOT NULL,action_data jsonb NOT NULL DEFAULT '{}',snapshot jsonb,revision int NOT NULL DEFAULT 0,error_code text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(client_id,request_key));
 CREATE INDEX IF NOT EXISTS scheduled_bookings_client ON scheduled_bookings(client_id,start_at);
 CREATE INDEX IF NOT EXISTS scheduled_bookings_expert ON scheduled_bookings(expert_code,start_at);
 CREATE INDEX IF NOT EXISTS scheduled_bookings_pending ON scheduled_bookings(updated_at) WHERE pending_action IS NOT NULL;
 CREATE TABLE IF NOT EXISTS booking_events(id uuid PRIMARY KEY,booking_id uuid NOT NULL,actor_id uuid NOT NULL,event text NOT NULL,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS communication_conversations(booking_id uuid PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS booking_notifications(id uuid PRIMARY KEY,event_id uuid NOT NULL,booking_id uuid NOT NULL,account_id uuid NOT NULL,event text NOT NULL,delivered_at timestamptz,read_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(event_id,account_id));
 CREATE TABLE IF NOT EXISTS communication_reminders(booking_id uuid NOT NULL,start_at timestamptz NOT NULL,minutes int NOT NULL,PRIMARY KEY(booking_id,start_at,minutes));
 CREATE TABLE IF NOT EXISTS live_session_provisions(booking_id uuid PRIMARY KEY,session_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS booking_reminders(booking_id uuid NOT NULL,start_at timestamptz NOT NULL,PRIMARY KEY(booking_id,start_at));
 ALTER TABLE scheduled_bookings ADD COLUMN IF NOT EXISTS operation_actor uuid;
 ALTER TABLE scheduled_bookings ADD COLUMN IF NOT EXISTS payment_id uuid;`);
}
async function event(
  db: PoolClient,
  row: Booking,
  actor: string,
  name: string,
  details: Record<string, unknown> = {},
) {
  const id = randomUUID();
  await db.query(
    'INSERT INTO booking_events(id,booking_id,actor_id,event,details) VALUES($1,$2,$3,$4,$5)',
    [id, row.id, actor, name, details],
  );
  for (const account of new Set([
    row.client_id,
    ...(row.snapshot?.expert_id ? [row.snapshot.expert_id] : []),
  ]))
    await db.query(
      'INSERT INTO booking_notifications(id,event_id,booking_id,account_id,event,delivered_at) VALUES($1,$2,$3,$4,$5,CASE WHEN $6 THEN now() ELSE NULL END)',
      [
        randomUUID(),
        id,
        row.id,
        account,
        name,
        name === 'REQUESTED' || (name === 'EXPIRED' && !row.snapshot),
      ],
    );
}
const publicRow = (r: Booking) => ({
  id: r.id,
  client_code: r.client_code,
  expert_code: r.expert_code,
  service_id: r.service_id,
  start_at: r.start_at,
  end_at: r.end_at,
  status: r.status,
  expires_at: r.expires_at,
  timezone: r.timezone,
  revision: r.revision,
  pending: !!r.pending_action,
  error_code: r.error_code,
  service: r.snapshot,
});
async function processOperation(pool: Pool, id: string): Promise<Booking> {
  return transaction(pool, async (db) => {
    const row = (await db.query('SELECT * FROM scheduled_bookings WHERE id=$1 FOR UPDATE', [id]))
      .rows[0] as Booking | undefined;
    if (!row) throw new ServiceError(404, 'NOT_FOUND');
    if (!row.pending_action) return row;
    let claim: Claim;
    try {
      claim = await internalCall<Claim>(
        'availability-service',
        '/internal/availability/allocate',
        '',
        {
          booking_id: row.id,
          operation_id: row.operation_id,
          client_id: row.client_id,
          expert: row.expert_code,
          service: row.service_id,
          start_at: row.action_data.start_at ?? new Date(row.start_at).toISOString(),
          action: row.pending_action,
        },
      );
    } catch (error) {
      if (!(error instanceof ServiceError) || error.status >= 500) throw error;
      // A confirmed old time remains reserved if an attempted move is unavailable.
      const status =
        row.pending_action === 'MOVE'
          ? (row.action_data.previous_status ?? 'CONFIRMED')
          : row.pending_action === 'CONFIRM' && error.code !== 'HOLD_EXPIRED'
            ? 'HELD'
            : 'EXPIRED';
      const failed = (
        await db.query(
          'UPDATE scheduled_bookings SET status=$2,pending_action=NULL,error_code=$3,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *',
          [id, status, error.code],
        )
      ).rows[0] as Booking;
      await event(
        db,
        failed,
        row.operation_actor ?? row.client_id,
        row.pending_action === 'MOVE' ? 'RESCHEDULE_REJECTED' : status,
        { code: error.code },
      );
      return failed;
    }
    const status =
      row.pending_action === 'MOVE'
        ? 'RESCHEDULED'
        : process.env.FINANCE_ENABLED === '1' &&
            claim.state === 'HELD' &&
            claim.snapshot.price_minor > 0
          ? 'BOOKING_PENDING_PAYMENT'
          : claim.state;
    const next = (
      await db.query(
        "UPDATE scheduled_bookings SET status=$2,start_at=COALESCE($3,start_at),end_at=COALESCE($4,end_at),expires_at=COALESCE($5,expires_at),snapshot=CASE WHEN pending_action='MOVE' THEN $6 ELSE COALESCE(snapshot,$6) END,pending_action=NULL,error_code=NULL,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
        [
          id,
          status,
          claim.start_at ?? null,
          claim.end_at ?? null,
          claim.expires_at ?? null,
          claim.snapshot ?? null,
        ],
      )
    ).rows[0] as Booking;
    await event(db, next, row.operation_actor ?? row.client_id, status, {
      previous_start: new Date(row.start_at).toISOString(),
    });
    return next;
  });
}
export async function reconcileBookings(pool: Pool) {
  const rows = (
    await pool.query(
      "SELECT id FROM scheduled_bookings WHERE pending_action IS NOT NULL AND updated_at<now()-interval '5 seconds' ORDER BY updated_at LIMIT 30",
    )
  ).rows;
  for (const row of rows) {
    try {
      await processOperation(pool, row.id);
    } catch {
      /* Durable intent is retried after dependency recovery. */
    }
  }
  await transaction(pool, async (db) => {
    const expired = (
      await db.query(
        "SELECT * FROM scheduled_bookings WHERE status IN ('HELD','BOOKING_PENDING_PAYMENT') AND pending_action IS NULL AND expires_at<=now() FOR UPDATE SKIP LOCKED",
      )
    ).rows as Booking[];
    for (const row of expired) {
      await db.query(
        "UPDATE scheduled_bookings SET status='EXPIRED',revision=revision+1,updated_at=now() WHERE id=$1",
        [row.id],
      );
      await event(db, row, row.client_id, 'EXPIRED');
    }
    const due = (
      await db.query(
        "SELECT * FROM scheduled_bookings WHERE status IN ('CONFIRMED','RESCHEDULED') AND pending_action IS NULL AND start_at>now() AND start_at<=now()+interval '24 hours' FOR UPDATE SKIP LOCKED",
      )
    ).rows as Booking[];
    for (const row of due) {
      if (process.env.COMMUNICATIONS_ENABLED === '1') {
        for (const minutes of [1440, 60, 10]) {
          const remaining = Date.parse(String(row.start_at)) - Date.now();
          if (remaining > minutes * 60000 || remaining < Math.max(0, minutes * 60000 - 120000))
            continue;
          if (
            (
              await db.query(
                'INSERT INTO communication_reminders VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING booking_id',
                [row.id, row.start_at, minutes],
              )
            ).rowCount
          )
            await event(db, row, row.client_id, 'REMINDER_' + minutes);
        }
      } else if (
        (
          await db.query(
            'INSERT INTO booking_reminders VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING booking_id',
            [row.id, row.start_at],
          )
        ).rowCount
      )
        await event(db, row, row.client_id, 'REMINDER');
    }
  });
  if (process.env.LIVE_SESSIONS_ENABLED === '1') {
    for (const row of (
      await pool.query(
        "SELECT id FROM scheduled_bookings b WHERE status IN ('CONFIRMED','RESCHEDULED','RESCHEDULE_REQUESTED') AND snapshot->>'kind' IN ('AUDIO','VIDEO','TEXT') AND end_at>now() AND NOT EXISTS(SELECT 1 FROM live_session_provisions p WHERE p.booking_id=b.id) ORDER BY updated_at LIMIT 30",
      )
    ).rows) {
      try {
        const session = await internalCall<{ id: string }>(
          'media-service',
          '/internal/sessions/provision',
          '',
          { booking_id: row.id },
        );
        await pool.query(
          'INSERT INTO live_session_provisions(booking_id,session_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [row.id, session.id],
        );
      } catch {
        /* Durable selection retries after media owner recovery. */
      }
    }
  }
  if (process.env.COMMUNICATIONS_ENABLED === '1') {
    for (const row of (
      await pool.query(
        "SELECT id FROM scheduled_bookings b WHERE status IN ('CONFIRMED','COMPLETED','RESCHEDULED','RESCHEDULE_REQUESTED') AND NOT EXISTS(SELECT 1 FROM communication_conversations c WHERE c.booking_id=b.id) ORDER BY updated_at LIMIT 30",
      )
    ).rows) {
      try {
        await internalCall('messaging-service', '/internal/communications/booking', '', {
          booking_id: row.id,
        });
        await pool.query(
          'INSERT INTO communication_conversations(booking_id) VALUES($1) ON CONFLICT DO NOTHING',
          [row.id],
        );
      } catch {
        /* Retry owner-verified provisioning independently of notification delivery. */
      }
    }
  }
  for (const item of (
    await pool.query(
      'SELECT id,account_id,event,booking_id FROM booking_notifications WHERE delivered_at IS NULL ORDER BY created_at LIMIT 30',
    )
  ).rows) {
    try {
      if (process.env.COMMUNICATIONS_ENABLED === '1')
        await internalCall('notification-service', '/internal/notifications', '', {
          id: item.id,
          account_id: item.account_id,
          event: item.event,
          category: 'BOOKINGS',
          context_id: item.booking_id,
        });
      else
        await internalCall('identity-service', '/internal/booking-notification', '', {
          id: item.id,
          account_id: item.account_id,
          event: item.event,
        });
      await pool.query('UPDATE booking_notifications SET delivered_at=now() WHERE id=$1', [
        item.id,
      ]);
    } catch {
      /* Outbox remains pending. */
    }
  }
}
export function schedulingWorker(pool: Pool) {
  let stopped = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  const tick = () => {
    void reconcileBookings(pool)
      .catch(() => {})
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, 3000);
      });
  };
  tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
export function schedulingRouter(pool: Pool) {
  const router = internalRouter();
  if (process.env.FINANCE_ENABLED === '1') {
    router.post(
      '/internal/bookings/financial-cancel',
      endpoint(async (req, res) => {
        const d = z
          .object({ booking_id: z.string().uuid(), payment_id: z.string().uuid() })
          .strict()
          .parse(req.body);
        await transaction(pool, async (db) => {
          const row = (
            await db.query('SELECT * FROM scheduled_bookings WHERE id=$1 FOR UPDATE', [
              d.booking_id,
            ])
          ).rows[0];
          if (!row) throw new ServiceError(404, 'NOT_FOUND');
          if (row.payment_id && row.payment_id !== d.payment_id)
            throw new ServiceError(409, 'PAYMENT_BOOKING_MISMATCH');
          if (['CANCELLED', 'EXPIRED', 'COMPLETED'].includes(row.status)) return;
          if (row.pending_action) throw new ServiceError(409, 'CONFLICT');
          await db.query(
            "UPDATE scheduled_bookings SET pending_action='CANCEL',operation_id=$2,operation_actor=client_id,action_data=$3 WHERE id=$1",
            [d.booking_id, d.payment_id, { intent: 'financial-cancel' }],
          );
        });
        res.json({ data: { status: (await processOperation(pool, d.booking_id)).status } });
      }),
    );
    router.get(
      '/internal/bookings/payment-quote/:id',
      endpoint(async (req, res) => {
        const user = await principal(req),
          id = z.string().uuid().parse(req.params.id);
        const row = (await pool.query('SELECT * FROM scheduled_bookings WHERE id=$1', [id]))
          .rows[0] as Booking | undefined;
        if (!row) throw new ServiceError(404, 'NOT_FOUND');
        if (row.client_id !== user.id) throw new ServiceError(403, 'FORBIDDEN');
        res.json({
          data: {
            id: row.id,
            client_id: row.client_id,
            expert_id: row.snapshot?.expert_id,
            status: row.status,
            expires_at: row.expires_at,
            amount: String(row.snapshot?.price_minor ?? 0),
            currency: row.snapshot?.currency,
            service_id: row.service_id,
            specialty_id: row.snapshot?.specialty_id,
            country: row.snapshot?.country,
            kind: row.snapshot?.kind,
            end_at: row.end_at,
          },
        });
      }),
    );
    router.get(
      '/internal/bookings/financial-state/:id',
      endpoint(async (req, res) => {
        const row = (
          await pool.query(
            'SELECT id,client_id,snapshot,status,end_at,payment_id FROM scheduled_bookings WHERE id=$1',
            [z.string().uuid().parse(req.params.id)],
          )
        ).rows[0];
        if (!row) throw new ServiceError(404, 'NOT_FOUND');
        res.json({
          data: {
            id: row.id,
            client_id: row.client_id,
            expert_id: row.snapshot?.expert_id,
            status: row.status,
            end_at: row.end_at,
            payment_id: row.payment_id,
            kind: row.snapshot?.kind,
          },
        });
      }),
    );
    router.post(
      '/internal/bookings/payment-confirm',
      endpoint(async (req, res) => {
        const d = z
          .object({
            booking_id: z.string().uuid(),
            payment_id: z.string().uuid(),
            account_id: z.string().uuid(),
            amount: z.string().regex(/^[1-9][0-9]*$/),
            currency: z.string(),
          })
          .strict()
          .parse(req.body);
        await transaction(pool, async (db) => {
          const row = (
            await db.query('SELECT * FROM scheduled_bookings WHERE id=$1 FOR UPDATE', [
              d.booking_id,
            ])
          ).rows[0];
          if (
            !row ||
            row.client_id !== d.account_id ||
            String(row.snapshot?.price_minor) !== d.amount ||
            row.snapshot?.currency !== d.currency
          )
            throw new ServiceError(409, 'PAYMENT_BOOKING_MISMATCH');
          if (row.payment_id && row.payment_id !== d.payment_id)
            throw new ServiceError(409, 'BOOKING_ALREADY_PAID');
          if (
            ['CONFIRMED', 'RESCHEDULED', 'COMPLETED'].includes(row.status) &&
            row.payment_id === d.payment_id
          )
            return;
          if (!['HELD', 'BOOKING_PENDING_PAYMENT'].includes(row.status) || row.pending_action)
            return;
          if (new Date(row.expires_at).getTime() <= Date.now()) {
            await db.query("UPDATE scheduled_bookings SET status='EXPIRED' WHERE id=$1", [
              d.booking_id,
            ]);
            return;
          }
          await db.query(
            "UPDATE scheduled_bookings SET payment_id=$2,pending_action='CONFIRM',operation_id=$2,operation_actor=client_id,action_data=$3 WHERE id=$1",
            [d.booking_id, d.payment_id, { intent: 'paid-confirm' }],
          );
        });
        const row = await processOperation(pool, d.booking_id);
        res.json({ data: { status: row.status } });
      }),
    );
  }

  router.get(
    '/api/v2/bookings/public-stats',
    endpoint(async (req, res) => {
      const raw = String(
        req.query.experts ?? '',
      );

      const experts = z
        .array(code)
        .max(50)
        .parse(
          raw
            ? raw.split(',').filter(Boolean)
            : [],
        );

      if (!experts.length) {
        res.json({
          data: [],
        });
        return;
      }

      const publicExperts = await internalCall<
        { account_id: string; expert_code: string }[]
      >(
        'scholar-service',
        '/internal/discovery/identities?' +
          new URLSearchParams({
            codes: experts.join(','),
          }),
      );

      const allowed = new Set(
        publicExperts.map(
          (item) => item.expert_code,
        ),
      );

      const rows = (
        await pool.query(
          `SELECT
             expert_code,
             count(*)::int AS completed_sessions
           FROM scheduled_bookings
           WHERE expert_code=ANY($1::text[])
             AND status='COMPLETED'
           GROUP BY expert_code`,
          [
            experts.filter(
              (expert) =>
                allowed.has(expert),
            ),
          ],
        )
      ).rows;

      res.json({
        data: experts
          .filter(
            (expert) =>
              allowed.has(expert),
          )
          .map(
            (expert) => ({
              expert_code: expert,

              completed_sessions:
                rows.find(
                  (row) =>
                    row.expert_code === expert,
                )?.completed_sessions ?? 0,
            }),
          ),
      });
    }),
  );

  router.post(
    '/api/v2/bookings/scheduled',
    endpoint(async (req, res) => {
      const user = await principal(req),
        input = z
          .object({
            request_key: z.string().uuid(),
            expert: code,
            service: z.string().uuid(),
            start_at: utc,
            timezone,
          })
          .strict()
          .parse(req.body);
      if (input.expert === user.public_id) throw new ServiceError(400, 'SELF_BOOKING');
      const id = await transaction(pool, async (db) => {
        const created = (
          await db.query(
            "INSERT INTO scheduled_bookings(id,client_id,client_code,expert_code,service_id,start_at,timezone,request_key,request_data,pending_action,operation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'HOLD',$10) ON CONFLICT(client_id,request_key) DO NOTHING RETURNING id",
            [
              randomUUID(),
              user.id,
              user.public_id,
              input.expert,
              input.service,
              input.start_at,
              input.timezone,
              input.request_key,
              input,
              randomUUID(),
            ],
          )
        ).rows[0];
        const existing = (
          await db.query('SELECT * FROM scheduled_bookings WHERE client_id=$1 AND request_key=$2', [
            user.id,
            input.request_key,
          ])
        ).rows[0];
        if (
          Object.keys(input).some(
            (k) => existing.request_data[k] !== input[k as keyof typeof input],
          )
        )
          throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT');
        if (created) await event(db, existing, user.id, 'REQUESTED');
        return existing.id as string;
      });
      const row = await processOperation(pool, id);
      if (row.error_code) throw new ServiceError(409, row.error_code);
      res.status(201).json({ data: publicRow(row) });
    }),
  );
  router.get(
    '/api/v2/bookings/scheduled',
    endpoint(async (req, res) => {
      const user = await principal(req),
        q = z
          .object({
            view: z.enum(['mine', 'expert', 'admin']).default('mine'),
            offset: z.coerce.number().int().min(0).max(100000).default(0),
            period: z.enum(['all', 'future', 'past', 'cancelled']).default('all'),
            from: utc.optional(),
            to: utc.optional(),
          })
          .strict()
          .parse(req.query);
      if ((q.from && !q.to) || (!q.from && q.to) || (q.from && q.to && q.from >= q.to))
        throw new ServiceError(400, 'INVALID_INPUT');
      if (q.view === 'expert') await requirePermission(req, 'booking.attend');
      if (q.view === 'admin') await requirePermission(req, 'booking.manage');
      const rows = (
        await pool.query(
          `SELECT *,CASE WHEN status IN ('HELD','BOOKING_PENDING_PAYMENT') AND expires_at<=now() AND pending_action IS NULL THEN 'EXPIRED' ELSE status END AS status FROM scheduled_bookings WHERE (($2='mine' AND client_id=$1) OR($2='expert' AND expert_code=$3) OR $2='admin') AND ($4='all' OR($4='future' AND start_at>=now() AND status NOT IN ('CANCELLED','EXPIRED')) OR($4='past' AND start_at<now()) OR($4='cancelled' AND status IN ('CANCELLED','EXPIRED'))) AND ($6::timestamptz IS NULL OR start_at >= $6) AND ($7::timestamptz IS NULL OR start_at < $7) ORDER BY start_at DESC,id LIMIT 100 OFFSET $5`,
          [user.id, q.view, user.public_id, q.period, q.offset, q.from ?? null, q.to ?? null],
        )
      ).rows as Booking[];
      res.json({ data: rows.map(publicRow) });
    }),
  );
  router.post(
    '/api/v2/bookings/scheduled/:id/:action',
    endpoint(async (req, res) => {
      const user = await principal(req),
        id = z.string().uuid().parse(req.params.id),
        action = z.enum(['confirm', 'cancel', 'reschedule', 'complete']).parse(req.params.action);
      const input = z
        .object({
          revision: z.number().int().nonnegative(),
          request_key: z.string().uuid(),
          start_at: utc.optional(),
        })
        .strict()
        .parse(req.body);
      await transaction(pool, async (db) => {
        const row = (
          await db.query('SELECT * FROM scheduled_bookings WHERE id=$1 FOR UPDATE', [id])
        ).rows[0] as Booking | undefined;
        if (!row) throw new ServiceError(404, 'NOT_FOUND');
        const owner = row.client_id === user.id,
          expert = row.expert_code === user.public_id;
        if (!owner && !expert) throw new ServiceError(403, 'FORBIDDEN');
        if ((action === 'confirm' && !owner) || (action === 'complete' && !expert))
          throw new ServiceError(403, 'FORBIDDEN');
        if (row.operation_id === input.request_key) {
          if (row.action_data.intent !== action || row.action_data.start_at !== input.start_at)
            throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT');
          return;
        }
        if (row.revision !== input.revision || row.pending_action)
          throw new ServiceError(409, 'CONFLICT');
        if (action === 'confirm' && (row.snapshot?.price_minor ?? 0) > 0)
          throw new ServiceError(409, 'PAYMENT_REQUIRED');
        if (action === 'confirm' && row.status !== 'HELD')
          throw new ServiceError(409, 'HOLD_EXPIRED');
        if (
          action === 'cancel' &&
          !['HELD', 'BOOKING_PENDING_PAYMENT', 'CONFIRMED', 'RESCHEDULED'].includes(row.status)
        )
          throw new ServiceError(409, 'CONFLICT');
        if (
          ['reschedule', 'complete'].includes(action) &&
          !['CONFIRMED', 'RESCHEDULED'].includes(row.status)
        )
          throw new ServiceError(409, 'CONFLICT');
        if (
          ['cancel', 'reschedule'].includes(action) &&
          owner &&
          !['HELD', 'BOOKING_PENDING_PAYMENT'].includes(row.status) &&
          Date.parse(row.start_at) - Date.now() < (row.snapshot?.cancellation_hours ?? 24) * 3600000
        )
          throw new ServiceError(409, 'CANCELLATION_CUTOFF');
        if (['cancel', 'reschedule'].includes(action) && Date.parse(row.start_at) <= Date.now())
          throw new ServiceError(409, 'SESSION_STARTED');
        if (
          action === 'reschedule' &&
          (!input.start_at || input.start_at === new Date(row.start_at).toISOString())
        )
          throw new ServiceError(400, 'INVALID_INPUT');
        if (action === 'complete') {
          if (!row.end_at || Date.parse(row.end_at) > Date.now())
            throw new ServiceError(409, 'SESSION_NOT_ENDED');
          await db.query(
            "UPDATE scheduled_bookings SET status='COMPLETED',operation_id=$2,operation_actor=$3,action_data=$4,revision=revision+1,updated_at=now() WHERE id=$1",
            [id, input.request_key, user.id, { intent: action }],
          );
          await event(db, row, user.id, 'COMPLETED');
          return;
        }
        await db.query(
          "UPDATE scheduled_bookings SET pending_action=$2,operation_id=$3,action_data=$4,operation_actor=$5,error_code=NULL,status=CASE WHEN $2='MOVE' THEN 'RESCHEDULE_REQUESTED' ELSE status END,updated_at=now() WHERE id=$1",
          [
            id,
            action === 'confirm' ? 'CONFIRM' : action === 'cancel' ? 'CANCEL' : 'MOVE',
            input.request_key,
            {
              ...(input.start_at ? { start_at: input.start_at } : {}),
              previous_status: row.status,
              intent: action,
            },
            user.id,
          ],
        );
        if (action === 'reschedule') await event(db, row, user.id, 'RESCHEDULE_REQUESTED');
      });
      const row = await processOperation(pool, id);
      if (row.error_code) throw new ServiceError(409, row.error_code);
      res.json({ data: publicRow(row) });
    }),
  );
  router.get(
    '/internal/bookings/communication-context/:id',
    endpoint(async (req, res) => {
      const u = await principal(req),
        row = (
          await pool.query('SELECT client_id,snapshot,status FROM scheduled_bookings WHERE id=$1', [
            z.string().uuid().parse(req.params.id),
          ])
        ).rows[0];
      if (!row || ![row.client_id, row.snapshot?.expert_id].includes(u.id))
        throw new ServiceError(403, 'FORBIDDEN');
      res.json({
        data: {
          client_id: row.client_id,
          expert_id: row.snapshot.expert_id,
          status: row.status,
          kind: row.snapshot.kind ?? 'VIDEO',
        },
      });
    }),
  );
  router.get(
    '/internal/bookings/session-context/:id',
    endpoint(async (req, res) => {
      const row = (
        await pool.query('SELECT * FROM scheduled_bookings WHERE id=$1', [
          z.string().uuid().parse(req.params.id),
        ])
      ).rows[0];
      if (!row) throw new ServiceError(404, 'NOT_FOUND');
      res.json({
        data: {
          id: row.id,
          client_id: row.client_id,
          expert_id: row.snapshot?.expert_id,
          status: row.status,
          start_at: row.start_at,
          end_at: row.end_at,
          kind: row.snapshot?.kind,
          title: row.snapshot?.title,
          expert_name: row.snapshot?.expert_name,
          call_policy: row.snapshot?.call_policy ?? {},
        },
      });
    }),
  );
  router.post(
    '/internal/bookings/session-completed',
    endpoint(async (req, res) => {
      const d = z
        .object({ session_id: z.string().uuid(), booking_id: z.string().uuid() })
        .strict()
        .parse(req.body);
      const evidence = await internalCall<{
        booking_id: string;
        state: string;
        actual_started_at: string | null;
        actual_ended_at: string | null;
      }>('media-service', '/internal/sessions/' + d.session_id + '/evidence');
      if (
        evidence.booking_id !== d.booking_id ||
        evidence.state !== 'COMPLETED' ||
        !evidence.actual_started_at ||
        !evidence.actual_ended_at
      )
        throw new ServiceError(409, 'SESSION_NOT_COMPLETED');
      await transaction(pool, async (db) => {
        const row = (
          await db.query('SELECT * FROM scheduled_bookings WHERE id=$1 FOR UPDATE', [d.booking_id])
        ).rows[0] as Booking | undefined;
        if (!row) throw new ServiceError(404, 'NOT_FOUND');
        if (row.status === 'COMPLETED') return;
        if (!['CONFIRMED', 'RESCHEDULED'].includes(row.status) || row.pending_action)
          throw new ServiceError(409, 'CONFLICT');
        await db.query(
          "UPDATE scheduled_bookings SET status='COMPLETED',revision=revision+1,updated_at=now() WHERE id=$1",
          [row.id],
        );
        await event(db, row, row.snapshot!.expert_id, 'COMPLETED');
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.get(
    '/api/v2/bookings/notifications',
    endpoint(async (req, res) => {
      const user = await principal(req);
      res.json({
        data: (
          await pool.query(
            'SELECT id,booking_id,event,read_at,created_at FROM booking_notifications WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100',
            [user.id],
          )
        ).rows,
      });
    }),
  );
  router.post(
    '/api/v2/bookings/notifications/:id/read',
    endpoint(async (req, res) => {
      const user = await principal(req),
        id = z.string().uuid().parse(req.params.id);
      await pool.query(
        'UPDATE booking_notifications SET read_at=now() WHERE id=$1 AND account_id=$2',
        [id, user.id],
      );
      res.json({ data: { ok: true } });
    }),
  );
  return router;
}
