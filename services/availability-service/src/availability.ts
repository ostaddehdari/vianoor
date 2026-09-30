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
import {
  calendarSchema,
  exceptionSchema,
  holidaySchema,
  instant,
  timezone,
  resolveLocal,
  generateSlots,
  type Calendar,
  type Holiday,
  type Exception,
} from './time.js';
const code = z.string().regex(/^[A-Za-z0-9]{13}$/);
type Service = {
  service_id: string;
  service_revision: number;
  expert_id: string;
  expert_code: string;
  expert_name: string;
  title: string;
  duration_minutes: number;
  price_minor: number;
  currency: string;
};
type Slot = { start_at: string; end_at: string; busy_start: string; busy_end: string };
const blank: Calendar = {
  timezone: 'Asia/Tehran',
  weekly: [],
  breaks: [],
  buffer_before: 0,
  buffer_after: 0,
  min_notice_minutes: 60,
  horizon_days: 90,
  cancellation_hours: 24,
  revision: 0,
};
export async function initializeAvailability(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS expert_calendars(expert_code varchar(13) PRIMARY KEY,settings jsonb NOT NULL,revision int NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS calendar_exceptions(id uuid PRIMARY KEY,expert_code varchar(13) NOT NULL,kind text NOT NULL,start_at timestamptz NOT NULL,end_at timestamptz NOT NULL,title text NOT NULL,CHECK(end_at>start_at));
  CREATE INDEX IF NOT EXISTS calendar_exception_time ON calendar_exceptions(expert_code,start_at,end_at);
  CREATE TABLE IF NOT EXISTS system_holidays(id uuid PRIMARY KEY,details jsonb NOT NULL);
  CREATE TABLE IF NOT EXISTS calendar_settings(id int PRIMARY KEY CHECK(id=1),revision int NOT NULL DEFAULT 0,hold_seconds int NOT NULL DEFAULT 300 CHECK(hold_seconds BETWEEN 30 AND 900));
  INSERT INTO calendar_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
  CREATE TABLE IF NOT EXISTS availability_slot_sets(expert_code varchar(13),service_id uuid,utc_day date,version text NOT NULL,generated_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(expert_code,service_id,utc_day));
  CREATE TABLE IF NOT EXISTS availability_slots(expert_code varchar(13),service_id uuid,start_at timestamptz,end_at timestamptz NOT NULL,busy_start timestamptz NOT NULL,busy_end timestamptz NOT NULL,PRIMARY KEY(expert_code,service_id,start_at));
  CREATE INDEX IF NOT EXISTS availability_search_time ON availability_slots(start_at,expert_code);
  CREATE TABLE IF NOT EXISTS slot_claims(booking_id uuid PRIMARY KEY,client_id uuid NOT NULL,expert_code varchar(13) NOT NULL,service_id uuid NOT NULL,start_at timestamptz NOT NULL,end_at timestamptz NOT NULL,busy_start timestamptz NOT NULL,busy_end timestamptz NOT NULL,state text NOT NULL CHECK(state IN ('HELD','CONFIRMED','CANCELLED','EXPIRED')),expires_at timestamptz NOT NULL,operation_id uuid NOT NULL,snapshot jsonb NOT NULL,CHECK(end_at>start_at),CHECK(busy_end>busy_start));
  CREATE INDEX IF NOT EXISTS slot_claim_overlap ON slot_claims(expert_code,busy_start,busy_end) WHERE state IN ('HELD','CONFIRMED');
  CREATE TABLE IF NOT EXISTS calendar_audit(id bigserial PRIMARY KEY,actor text NOT NULL,target text NOT NULL,action text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());`);
}
async function lock(db: PoolClient, expert: string) {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,901))', [expert]);
}
async function settings(db: Pool | PoolClient, expert: string): Promise<Calendar> {
  const row = (
    await db.query('SELECT settings,revision FROM expert_calendars WHERE expert_code=$1', [expert])
  ).rows[0];
  return row ? { ...row.settings, revision: row.revision } : { ...blank };
}
async function service(expert: string, id: string): Promise<Service> {
  const rows = await internalCall<Service[]>(
    'scholar-service',
    '/internal/scheduling/services?' + new URLSearchParams({ expert, service: id }),
  );
  if (!rows[0]) throw new ServiceError(409, 'SERVICE_UNAVAILABLE');
  return rows[0];
}
async function materialize(
  db: PoolClient,
  expert: string,
  offering: Service,
  from: number,
  to: number,
) {
  const cal = await settings(db, expert);
  const global = (await db.query('SELECT * FROM calendar_settings WHERE id=1 FOR SHARE')).rows[0];
  const version = [
    cal.revision,
    global.revision,
    offering.service_revision,
    offering.duration_minutes,
  ].join(':');
  const exceptions = (
    await db.query(
      'SELECT id,kind,start_at::text,end_at::text FROM calendar_exceptions WHERE expert_code=$1 AND end_at>$2 AND start_at<$3',
      [
        expert,
        new Date(Math.floor(from / 86400000) * 86400000 - 86400000),
        new Date(Math.ceil(to / 86400000) * 86400000 + 86400000),
      ],
    )
  ).rows as Exception[];
  const holidays = (await db.query('SELECT details FROM system_holidays')).rows.map(
    (r) => r.details as Holiday,
  );
  for (let day = Math.floor(from / 86400000) * 86400000; day < to; day += 86400000) {
    const date = new Date(day).toISOString().slice(0, 10);
    const cached = (
      await db.query(
        "SELECT 1 FROM availability_slot_sets WHERE expert_code=$1 AND service_id=$2 AND utc_day=$3 AND version=$4 AND generated_at>clock_timestamp()-interval '10 minutes'",
        [expert, offering.service_id, date, version],
      )
    ).rowCount;
    if (cached) continue;
    const slots = generateSlots(
      cal,
      exceptions,
      holidays,
      day,
      day + 86400000,
      offering.duration_minutes,
    );
    await db.query(
      'DELETE FROM availability_slots WHERE expert_code=$1 AND service_id=$2 AND start_at>=$3 AND start_at<$4',
      [expert, offering.service_id, new Date(day), new Date(day + 86400000)],
    );
    if (slots.length)
      await db.query(
        'INSERT INTO availability_slots SELECT $1,$2,x.start_at,x.end_at,x.busy_start,x.busy_end FROM jsonb_to_recordset($3::jsonb) AS x(start_at timestamptz,end_at timestamptz,busy_start timestamptz,busy_end timestamptz)',
        [expert, offering.service_id, JSON.stringify(slots)],
      );
    await db.query(
      'INSERT INTO availability_slot_sets(expert_code,service_id,utc_day,version) VALUES($1,$2,$3,$4) ON CONFLICT(expert_code,service_id,utc_day) DO UPDATE SET version=$4,generated_at=clock_timestamp()',
      [expert, offering.service_id, date, version],
    );
  }
  return { cal, global };
}
const range = z
  .object({ expert: code, service: z.string().uuid(), from: instant, to: instant, timezone })
  .strict()
  .refine(
    (v) =>
      Date.parse(v.to) > Date.parse(v.from) &&
      Date.parse(v.to) - Date.parse(v.from) <= 31 * 86400000,
  );
export function availabilityRouter(pool: Pool) {
  const router = internalRouter('128kb');
  router.get(
    '/api/v2/availability/public',
    endpoint(async (req, res) => {
      const input = z
        .object({
          experts: z.string().max(700),
          timezone,
          days: z.coerce.number().int().min(1).max(14).default(7),
        })
        .strict()
        .parse(req.query);

      const experts = z
        .array(code)
        .max(30)
        .parse(input.experts.split(',').filter(Boolean));

      if (!experts.length) {
        res.json({ data: [] });
        return;
      }

      const services = (
        await internalCall<Service[]>(
          'scholar-service',
          '/internal/scheduling/services',
        )
      ).filter((service) => experts.includes(service.expert_code));

      const now = Date.now();
      const until = now + input.days * 86400000;

      const dayKey = (value: Date) => {
        const parts = new Intl.DateTimeFormat('en', {
          timeZone: input.timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).formatToParts(value);

        const map = Object.fromEntries(
          parts.map((part) => [part.type, part.value]),
        );

        return `${map.year}-${map.month}-${map.day}`;
      };

      const today = dayKey(new Date(now));
      const output = [];

      for (const expert of experts) {
        let earliest:
          | {
              service_id: string;
              start_at: string;
              end_at: string;
            }
          | null = null;

        for (const offering of services.filter(
          (service) => service.expert_code === expert,
        )) {
          const found = await transaction(pool, async (db) => {
            await lock(db, expert);

            const { cal } = await materialize(
              db,
              expert,
              offering,
              now,
              until,
            );

            return (
              await db.query(
                `SELECT s.start_at::text,s.end_at::text
                 FROM availability_slots s
                 WHERE s.expert_code=$1
                   AND s.service_id=$2
                   AND s.start_at>=clock_timestamp()+($3*interval '1 minute')
                   AND s.start_at<$4
                   AND s.start_at<=clock_timestamp()+($5*interval '1 day')
                   AND NOT EXISTS(
                     SELECT 1
                     FROM slot_claims c
                     WHERE c.expert_code=s.expert_code
                       AND (
                         c.state='CONFIRMED'
                         OR (
                           c.state='HELD'
                           AND c.expires_at>clock_timestamp()
                         )
                       )
                       AND c.busy_start<s.busy_end
                       AND c.busy_end>s.busy_start
                   )
                 ORDER BY s.start_at
                 LIMIT 1`,
                [
                  expert,
                  offering.service_id,
                  cal.min_notice_minutes,
                  new Date(until),
                  cal.horizon_days,
                ],
              )
            ).rows[0];
          });

          if (
            found &&
            (
              !earliest ||
              Date.parse(found.start_at) <
                Date.parse(earliest.start_at)
            )
          ) {
            earliest = {
              service_id: offering.service_id,
              start_at: found.start_at,
              end_at: found.end_at,
            };
          }
        }

        output.push({
          expert_code: expert,
          earliest,
          available_today:
            !!earliest &&
            dayKey(new Date(earliest.start_at)) === today,
        });
      }

      res.json({ data: output });
    }),
  );

  router.post(
    '/api/v2/availability/resolve',
    endpoint(async (req, res) => {
      await principal(req);
      const data = z
        .object({
          local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
          timezone,
          disambiguation: z.enum(['reject', 'earlier', 'later']).default('reject'),
        })
        .strict()
        .parse(req.body);
      try {
        res.json({ data: { utc: resolveLocal(data.local, data.timezone, data.disambiguation) } });
      } catch {
        throw new ServiceError(400, 'AMBIGUOUS_OR_INVALID_TIME');
      }
    }),
  );
  router.get(
    '/api/v2/availability/services',
    endpoint(async (req, res) => {
      await principal(req);
      res.json({ data: await internalCall('scholar-service', '/internal/scheduling/services') });
    }),
  );
  router.get(
    '/api/v2/availability/slots',
    endpoint(async (req, res) => {
      await principal(req);
      const q = range.parse(req.query),
        offering = await service(q.expert, q.service);
      const data = await transaction(pool, async (db) => {
        await lock(db, q.expert);
        const { cal } = await materialize(
          db,
          q.expert,
          offering,
          Date.parse(q.from),
          Date.parse(q.to),
        );
        const rows = (
          await db.query(
            `SELECT s.start_at,s.end_at FROM availability_slots s WHERE s.expert_code=$1 AND s.service_id=$2 AND s.start_at>=$3 AND s.start_at<$4 AND s.start_at>=clock_timestamp()+($5*interval '1 minute') AND s.start_at<=clock_timestamp()+($6*interval '1 day') AND NOT EXISTS(SELECT 1 FROM slot_claims c WHERE c.expert_code=s.expert_code AND (c.state='CONFIRMED' OR(c.state='HELD' AND c.expires_at>clock_timestamp())) AND c.busy_start<s.busy_end AND c.busy_end>s.busy_start) ORDER BY s.start_at LIMIT 1500`,
            [q.expert, q.service, q.from, q.to, cal.min_notice_minutes, cal.horizon_days],
          )
        ).rows;
        return {
          service: offering,
          timezone: q.timezone,
          slots: rows,
          cancellation_hours: cal.cancellation_hours,
        };
      });
      res.json({ data });
    }),
  );
  router.get(
    '/api/v2/availability/search',
    endpoint(async (req, res) => {
      await principal(req);
      const q = z.object({ at: instant, timezone }).strict().parse(req.query);
      const offerings = await internalCall<Service[]>(
        'scholar-service',
        '/internal/scheduling/services',
      );
      const result = [];
      for (const offering of offerings) {
        const found = await transaction(pool, async (db) => {
          await lock(db, offering.expert_code);
          const { cal } = await materialize(
            db,
            offering.expert_code,
            offering,
            Date.parse(q.at),
            Date.parse(q.at) + 1,
          );
          return (
            await db.query(
              `SELECT s.start_at,s.end_at FROM availability_slots s WHERE s.expert_code=$1 AND s.service_id=$2 AND s.start_at=$3 AND s.start_at>=clock_timestamp()+($4*interval '1 minute') AND s.start_at<=clock_timestamp()+($5*interval '1 day') AND NOT EXISTS(SELECT 1 FROM slot_claims c WHERE c.expert_code=s.expert_code AND (c.state='CONFIRMED' OR(c.state='HELD' AND c.expires_at>clock_timestamp())) AND c.busy_start<s.busy_end AND c.busy_end>s.busy_start)`,
              [
                offering.expert_code,
                offering.service_id,
                q.at,
                cal.min_notice_minutes,
                cal.horizon_days,
              ],
            )
          ).rows[0];
        });
        if (found) result.push({ ...offering, ...found });
      }
      res.json({ data: result });
    }),
  );
  router.get(
    '/api/v2/availability/calendar',
    endpoint(async (req, res) => {
      const user = await requirePermission(req, 'booking.attend');
      res.json({
        data: {
          ...(await settings(pool, user.public_id)),
          exceptions: (
            await pool.query(
              'SELECT * FROM calendar_exceptions WHERE expert_code=$1 ORDER BY start_at',
              [user.public_id],
            )
          ).rows,
        },
      });
    }),
  );
  router.put(
    '/api/v2/availability/calendar',
    endpoint(async (req, res) => {
      const user = await requirePermission(req, 'booking.attend'),
        input = calendarSchema.parse(req.body);
      await transaction(pool, async (db) => {
        await lock(db, user.public_id);
        const old = await settings(db, user.public_id);
        if (old.revision !== input.revision) throw new ServiceError(409, 'CONFLICT');
        await db.query(
          'INSERT INTO expert_calendars(expert_code,settings,revision) VALUES($1,$2,1) ON CONFLICT(expert_code) DO UPDATE SET settings=$2,revision=expert_calendars.revision+1',
          [user.public_id, input],
        );
        await db.query(
          "INSERT INTO calendar_audit(actor,target,action) VALUES($1,$1,'calendar_updated')",
          [user.public_id],
        );
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.post(
    '/api/v2/availability/exceptions',
    endpoint(async (req, res) => {
      const user = await requirePermission(req, 'booking.attend'),
        input = exceptionSchema.parse(req.body),
        id = randomUUID();
      await transaction(pool, async (db) => {
        await lock(db, user.public_id);
        await db.query(
          'INSERT INTO calendar_exceptions(id,expert_code,kind,start_at,end_at,title) VALUES($1,$2,$3,$4,$5,$6)',
          [id, user.public_id, input.kind, input.start_at, input.end_at, input.title],
        );
        await db.query('DELETE FROM availability_slot_sets WHERE expert_code=$1', [user.public_id]);
        await db.query(
          "INSERT INTO calendar_audit(actor,target,action) VALUES($1,$2,'exception_created')",
          [user.public_id, id],
        );
      });
      res.json({ data: { id } });
    }),
  );
  router.post(
    '/api/v2/availability/exceptions/:id/remove',
    endpoint(async (req, res) => {
      const user = await requirePermission(req, 'booking.attend'),
        id = z.string().uuid().parse(req.params.id);
      await transaction(pool, async (db) => {
        await lock(db, user.public_id);
        if (
          !(
            await db.query('DELETE FROM calendar_exceptions WHERE id=$1 AND expert_code=$2', [
              id,
              user.public_id,
            ])
          ).rowCount
        )
          throw new ServiceError(404, 'NOT_FOUND');
        await db.query('DELETE FROM availability_slot_sets WHERE expert_code=$1', [user.public_id]);
        await db.query(
          "INSERT INTO calendar_audit(actor,target,action) VALUES($1,$2,'exception_removed')",
          [user.public_id, id],
        );
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.get(
    '/api/v2/availability/holidays',
    endpoint(async (req, res) => {
      await principal(req);
      res.json({ data: (await pool.query('SELECT * FROM system_holidays ORDER BY id')).rows });
    }),
  );
  router.post(
    '/api/v2/availability/holidays',
    endpoint(async (req, res) => {
      const user = await requirePermission(req, 'calendar.manage'),
        input = holidaySchema.parse(req.body),
        id = randomUUID();
      await transaction(pool, async (db) => {
        await db.query('UPDATE calendar_settings SET revision=revision+1 WHERE id=1');
        await db.query('INSERT INTO system_holidays VALUES($1,$2)', [id, input]);
        await db.query(
          "INSERT INTO calendar_audit(actor,target,action) VALUES($1,$2,'holiday_created')",
          [user.public_id, id],
        );
      });
      res.json({ data: { id } });
    }),
  );
  router.post(
    '/api/v2/availability/holidays/:id/remove',
    endpoint(async (req, res) => {
      const user = await requirePermission(req, 'calendar.manage'),
        id = z.string().uuid().parse(req.params.id);
      await transaction(pool, async (db) => {
        await db.query('UPDATE calendar_settings SET revision=revision+1 WHERE id=1');
        await db.query('DELETE FROM system_holidays WHERE id=$1', [id]);
        await db.query(
          "INSERT INTO calendar_audit(actor,target,action) VALUES($1,$2,'holiday_removed')",
          [user.public_id, id],
        );
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.get(
    '/api/v2/availability/settings',
    endpoint(async (req, res) => {
      await requirePermission(req, 'calendar.manage');
      res.json({ data: (await pool.query('SELECT * FROM calendar_settings WHERE id=1')).rows[0] });
    }),
  );
  router.put(
    '/api/v2/availability/settings',
    endpoint(async (req, res) => {
      const user = await requirePermission(req, 'calendar.manage');
      const data = z
        .object({ hold_seconds: z.number().int().min(30).max(900) })
        .strict()
        .parse(req.body);
      await transaction(pool, async (db) => {
        await db.query('UPDATE calendar_settings SET hold_seconds=$1 WHERE id=1', [
          data.hold_seconds,
        ]);
        await db.query(
          "INSERT INTO calendar_audit(actor,target,action) VALUES($1,'settings','settings_updated')",
          [user.public_id],
        );
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.post(
    '/internal/availability/allocate',
    endpoint(async (req, res) => {
      const data = z
        .object({
          booking_id: z.string().uuid(),
          operation_id: z.string().uuid(),
          client_id: z.string().uuid(),
          expert: code,
          service: z.string().uuid(),
          start_at: instant,
          action: z.enum(['HOLD', 'CONFIRM', 'CANCEL', 'MOVE']),
        })
        .strict()
        .parse(req.body);
      const result = await transaction(pool, async (db) => {
        await lock(db, data.expert);
        await db.query(
          "UPDATE slot_claims SET state='EXPIRED' WHERE expert_code=$1 AND state='HELD' AND expires_at<=clock_timestamp()",
          [data.expert],
        );
        const current = (
          await db.query('SELECT * FROM slot_claims WHERE booking_id=$1 FOR UPDATE', [
            data.booking_id,
          ])
        ).rows[0];
        if (
          current &&
          (current.client_id !== data.client_id ||
            current.expert_code !== data.expert ||
            current.service_id !== data.service)
        )
          throw new ServiceError(403, 'FORBIDDEN');
        if (data.action === 'HOLD' && current) return current;
        if (data.action === 'CANCEL') {
          if (!current) return { state: 'CANCELLED' };
          await db.query(
            "UPDATE slot_claims SET state='CANCELLED',operation_id=$2 WHERE booking_id=$1",
            [data.booking_id, data.operation_id],
          );
          return { ...current, state: 'CANCELLED' };
        }
        if (data.action === 'CONFIRM') {
          if (!current || !['HELD', 'CONFIRMED'].includes(current.state))
            throw new ServiceError(409, 'HOLD_EXPIRED');
          await service(data.expert, data.service);
          await db.query(
            "UPDATE slot_claims SET state='CONFIRMED',operation_id=$2 WHERE booking_id=$1",
            [data.booking_id, data.operation_id],
          );
          return { ...current, state: 'CONFIRMED' };
        }
        if (data.action === 'MOVE') {
          if (!current || current.state !== 'CONFIRMED') throw new ServiceError(409, 'CONFLICT');
          if (current.operation_id === data.operation_id) return current;
        }
        const conflict = await db.query(
          "SELECT 1 FROM slot_claims WHERE expert_code=$1 AND booking_id<>$2 AND (state='CONFIRMED' OR(state='HELD' AND expires_at>clock_timestamp())) AND busy_start<=$3 AND busy_end>$3 LIMIT 1",
          [data.expert, data.booking_id, data.start_at],
        );
        if (conflict.rowCount) throw new ServiceError(409, 'SLOT_ALREADY_RESERVED');
        const offering = await service(data.expert, data.service);
        if (offering.expert_id === data.client_id) throw new ServiceError(400, 'SELF_BOOKING');
        const at = Date.parse(data.start_at),
          { cal, global } = await materialize(db, data.expert, offering, at, at + 1);
        const slot = (
          await db.query(
            "SELECT start_at::text,end_at::text,busy_start::text,busy_end::text FROM availability_slots WHERE expert_code=$1 AND service_id=$2 AND start_at=$3 AND start_at>=clock_timestamp()+($4*interval '1 minute') AND start_at<=clock_timestamp()+($5*interval '1 day')",
            [data.expert, data.service, data.start_at, cal.min_notice_minutes, cal.horizon_days],
          )
        ).rows[0] as Slot | undefined;
        if (!slot) throw new ServiceError(409, 'SLOT_UNAVAILABLE');
        if (
          (
            await db.query(
              "SELECT 1 FROM slot_claims WHERE expert_code=$1 AND booking_id<>$2 AND (state='CONFIRMED' OR(state='HELD' AND expires_at>clock_timestamp())) AND busy_start<$3 AND busy_end>$4 LIMIT 1",
              [data.expert, data.booking_id, slot.busy_end, slot.busy_start],
            )
          ).rowCount
        )
          throw new ServiceError(409, 'SLOT_ALREADY_RESERVED');
        const snapshot = {
          ...offering,
          cancellation_hours: current?.snapshot?.cancellation_hours ?? cal.cancellation_hours,
          expert_timezone: cal.timezone,
          penalty_minor: 0,
          refund_mode:
            process.env.FINANCE_ENABLED === '1' ? 'REVIEW_POLICY' : 'NOT_APPLICABLE_STAGE_9',
        };
        const state = data.action === 'HOLD' ? 'HELD' : 'CONFIRMED';
        const row = (
          await db.query(
            `INSERT INTO slot_claims(booking_id,client_id,expert_code,service_id,start_at,end_at,busy_start,busy_end,state,expires_at,operation_id,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()+($10*interval '1 second'),$11,$12) ON CONFLICT(booking_id) DO UPDATE SET start_at=$5,end_at=$6,busy_start=$7,busy_end=$8,state=$9,operation_id=$11,snapshot=$12 RETURNING *`,
            [
              data.booking_id,
              data.client_id,
              data.expert,
              data.service,
              slot.start_at,
              slot.end_at,
              slot.busy_start,
              slot.busy_end,
              state,
              process.env.FINANCE_ENABLED === '1' && offering.price_minor > 0
                ? Math.max(global.hold_seconds, 1800)
                : global.hold_seconds,
              data.operation_id,
              snapshot,
            ],
          )
        ).rows[0];
        await db.query('INSERT INTO calendar_audit(actor,target,action) VALUES($1,$2,$3)', [
          data.client_id,
          data.booking_id,
          data.action,
        ]);
        return row;
      });
      res.json({ data: result });
    }),
  );
  return router;
}
