import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
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
  provision,
  context,
  membership,
  load,
  audit,
  notify,
  requestEnd,
  seal,
  open,
} from './model.js';
import {
  assertWindow,
  assertEligible,
  roleFor,
  waitingState,
  observerAllowed,
  terminal,
  type Session,
} from './policy.js';
import { issueToken, rooms } from './livekit.js';
const uuid = z.string().uuid();
async function observerConsent(s: Session, id: string) {
  const rows = await internalCall<{ account_id: string; accepted: boolean }[]>(
    'consent-service',
    '/internal/session-consents',
    '',
    { session_id: s.id, context_id: id, purpose: 'OBSERVER' },
  );
  return {
    client: !!rows.find((x) => x.account_id === s.client_id)?.accepted,
    expert: !!rows.find((x) => x.account_id === s.expert_id)?.accepted,
  };
}
export function sessionsRouter(pool: Pool) {
  const r = internalRouter();
  r.post(
    '/internal/sessions/provision',
    endpoint(async (req, res) => {
      const d = z.object({ booking_id: uuid }).strict().parse(req.body),
        b = await context(d.booking_id),
        s = await provision(pool, b, b.client_id);
      res.json({ data: { id: s.id } });
    }),
  );
  r.post(
    '/api/v2/sessions',
    endpoint(async (req, res) => {
      const u = await principal(req),
        d = z.object({ booking_id: uuid }).strict().parse(req.body);
      const s = await provision(pool, await context(d.booking_id), u.id);
      res.json({ data: { id: s.id } });
    }),
  );
  r.get(
    '/api/v2/sessions',
    endpoint(async (req, res) => {
      const u = await principal(req);
      res.json({
        data: (
          await pool.query(
            'SELECT s.id,s.booking_id,s.state,s.kind,s.title,s.expert_name,s.scheduled_start,s.scheduled_end,s.actual_started_at,s.actual_ended_at FROM live_sessions s JOIN session_members m ON m.session_id=s.id WHERE m.account_id=$1 AND NOT m.revoked ORDER BY s.scheduled_start DESC LIMIT 100',
            [u.id],
          )
        ).rows,
      });
    }),
  );
  r.get(
    '/api/v2/sessions/admin',
    endpoint(async (req, res) => {
      await requirePermission(req, 'session.monitor');
      res.json({
        data: (
          await pool.query(
            'SELECT s.id,s.state,s.kind,s.scheduled_start,s.scheduled_end,s.actual_started_at,s.actual_ended_at,(SELECT count(*)::int FROM session_members m WHERE m.session_id=s.id AND m.connected) AS participants FROM live_sessions s ORDER BY scheduled_start DESC LIMIT 100',
          )
        ).rows,
      });
    }),
  );
  r.get(
    '/api/v2/sessions/:id',
    endpoint(async (req, res) => {
      const u = await principal(req),
        { s, m } = await membership(pool, uuid.parse(req.params.id), u.id);
      res.json({
        data: {
          id: s.id,
          booking_id: s.booking_id,
          state: waitingState(s),
          kind: s.kind,
          title: s.title,
          expert_name: s.expert_name,
          scheduled_start: s.scheduled_start,
          scheduled_end: s.scheduled_end,
          actual_started_at: s.actual_started_at,
          actual_ended_at: s.actual_ended_at,
          policy: s.policy,
          role: m.role,
          ready: !!m.ready_at,
          server_now: new Date().toISOString(),
          members: (
            await pool.query(
              'SELECT identity,role,connected,waiting_at,joined_at,left_at,reconnects FROM session_members WHERE session_id=$1 AND NOT revoked',
              [s.id],
            )
          ).rows,
          observers: (
            await pool.query(
              'SELECT id,emergency,reason,created_at FROM session_observers WHERE session_id=$1 AND NOT revoked',
              [s.id],
            )
          ).rows,
          notes: !roleFor(s, u.id)
            ? []
            : (
                await pool.query(
                  "SELECT author_id,visibility,sealed_body FROM session_notes WHERE session_id=$1 AND (visibility='SHARED_SESSION_NOTE' OR author_id=$2)",
                  [s.id, u.id],
                )
              ).rows.map((n) => ({
                visibility: n.visibility,
                body: open(n.sealed_body, s.id + ':' + n.author_id + ':' + n.visibility),
              })),
        },
      });
    }),
  );
  r.post(
    '/api/v2/sessions/:id/waiting-room',
    endpoint(async (req, res) => {
      const u = await principal(req),
        { s, m } = await membership(pool, uuid.parse(req.params.id), u.id);
      assertEligible(await context(s.booking_id));
      assertWindow(s, Date.now(), true);
      if (!['CLIENT', 'EXPERT'].includes(m.role)) throw new ServiceError(403, 'FORBIDDEN');
      await pool.query(
        'UPDATE session_members SET waiting_at=COALESCE(waiting_at,now()),last_seen=now() WHERE session_id=$1 AND account_id=$2',
        [s.id, u.id],
      );
      await audit(pool, s.id, u.id, 'WAITING_ROOM_ENTERED');
      res.json({ data: { ok: true } });
    }),
  );
  r.post(
    '/api/v2/sessions/:id/device-check',
    endpoint(async (req, res) => {
      const u = await principal(req),
        { s } = await membership(pool, uuid.parse(req.params.id), u.id);
      assertWindow(s, Date.now(), true);
      const d = z
        .object({
          microphone: z.boolean(),
          camera: z.boolean(),
          webrtc: z.boolean(),
          latency_ms: z.number().min(0).max(60000),
          error: z.enum(['NONE', 'DENIED', 'UNAVAILABLE']).default('NONE'),
        })
        .strict()
        .parse(req.body);
      if (s.kind !== 'TEXT' && (!d.microphone || !d.webrtc || d.error !== 'NONE'))
        throw new ServiceError(409, 'DEVICE_CHECK_FAILED');
      await pool.query(
        'UPDATE session_members SET device_check=$3,ready_at=now() WHERE session_id=$1 AND account_id=$2',
        [s.id, u.id, d],
      );
      await audit(pool, s.id, u.id, 'DEVICE_CHECK_COMPLETED', d);
      res.json({ data: { ok: true } });
    }),
  );
  r.post(
    '/api/v2/sessions/:id/start',
    endpoint(async (req, res) => {
      const u = await principal(req),
        { s, m } = await membership(pool, uuid.parse(req.params.id), u.id);
      if (m.role !== 'EXPERT') throw new ServiceError(403, 'FORBIDDEN');
      assertEligible(await context(s.booking_id));
      assertWindow(s);
      if (!m.ready_at) throw new ServiceError(409, 'DEVICE_CHECK_REQUIRED');
      await transaction(pool, async (db) => {
        const latest = (
          await db.query('SELECT * FROM live_sessions WHERE id=$1 FOR UPDATE', [s.id])
        ).rows[0] as Session;
        assertWindow(latest);
        if (!['BOOKED', 'JOINABLE', 'IN_SESSION'].includes(latest.state))
          throw new ServiceError(409, 'SESSION_ENDED');
        const booking = await context(latest.booking_id);
        assertEligible(booking);
        if (new Date(booking.start_at).getTime() !== new Date(latest.scheduled_start).getTime())
          throw new ServiceError(409, 'SESSION_RESCHEDULED');
        if (latest.state !== 'BOOKED') return;
        if (latest.kind !== 'TEXT')
          await rooms().createRoom({
            name: latest.room_name,
            maxParticipants: 6,
            emptyTimeout: 120,
            departureTimeout: latest.policy.reconnect_seconds,
          });
        await db.query("UPDATE live_sessions SET state='JOINABLE' WHERE id=$1", [s.id]);
        await audit(db, s.id, u.id, 'SESSION_OPENED');
        await notify(db, latest, 'SESSION_JOINABLE');
      });
      res.json({ data: { ok: true } });
    }),
  );
  r.post(
    '/api/v2/sessions/:id/token',
    endpoint(async (req, res) => {
      const u = await principal(req),
        { s, m } = await membership(pool, uuid.parse(req.params.id), u.id);
      const b = await context(s.booking_id);
      assertEligible(b);
      if (new Date(b.start_at).getTime() !== new Date(s.scheduled_start).getTime())
        throw new ServiceError(409, 'SESSION_RESCHEDULED');
      assertWindow(s);
      if (!['JOINABLE', 'IN_SESSION'].includes(s.state))
        throw new ServiceError(409, 'EXPERT_HAS_NOT_STARTED');
      if (!m.ready_at && ['CLIENT', 'EXPERT'].includes(m.role))
        throw new ServiceError(409, 'DEVICE_CHECK_REQUIRED');
      if (s.kind === 'TEXT') throw new ServiceError(409, 'TEXT_SESSION_USE_CHAT');
      if (!roleFor(s, u.id)) {
        const o = (
          await pool.query(
            'SELECT * FROM session_observers WHERE session_id=$1 AND account_id=$2 AND NOT revoked ORDER BY created_at DESC LIMIT 1',
            [s.id, u.id],
          )
        ).rows[0];
        if (!o) throw new ServiceError(403, 'FORBIDDEN');
        await requirePermission(req, 'session.observe');
        if (o.emergency) await requirePermission(req, 'session.emergency');
        const c = await observerConsent(s, o.id);
        if (!observerAllowed(s.policy, c.client, c.expert, o.emergency))
          throw new ServiceError(403, 'OBSERVER_CONSENT_REQUIRED');
      }
      if (
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM session_events WHERE session_id=$1 AND account_id=$2 AND event='TOKEN_ISSUED' AND created_at>now()-interval '1 minute'",
              [s.id, u.id],
            )
          ).rows[0].count,
        ) >= 10
      )
        throw new ServiceError(429, 'TOKEN_RATE_LIMIT');
      await audit(pool, s.id, u.id, 'TOKEN_ISSUED', { role: m.role });
      res.json({ data: await issueToken(s, m.identity, m.role) });
    }),
  );
  r.post(
    '/api/v2/sessions/:id/end',
    endpoint(async (req, res) => {
      const u = await principal(req),
        { s, m } = await membership(pool, uuid.parse(req.params.id), u.id);
      if (m.role !== 'EXPERT') throw new ServiceError(403, 'FORBIDDEN');
      const d = z
        .object({
          outcome: z.enum(['COMPLETED', 'FOLLOW_UP_REQUIRED', 'TECHNICAL_FAILURE', 'INTERRUPTED']),
        })
        .strict()
        .parse(req.body);
      if (!s.actual_started_at && ['COMPLETED', 'FOLLOW_UP_REQUIRED'].includes(d.outcome))
        throw new ServiceError(409, 'SESSION_NOT_STARTED');
      await requestEnd(pool, s.id, u.id, d.outcome);
      res.json({ data: { state: 'ENDING' } });
    }),
  );
  r.post(
    '/api/v2/sessions/:id/leave',
    endpoint(async (req, res) => {
      const u = await principal(req),
        { s, m } = await membership(pool, uuid.parse(req.params.id), u.id);
      await pool.query(
        'UPDATE session_members SET intentional_leave=true,connected=false,left_at=now() WHERE session_id=$1 AND account_id=$2',
        [s.id, u.id],
      );
      if (s.kind !== 'TEXT' && m.connected)
        await rooms().removeParticipant(s.room_name, m.identity);
      await audit(pool, s.id, u.id, 'PARTICIPANT_LEFT_INTENTIONALLY');
      res.json({ data: { ok: true } });
    }),
  );
  r.post(
    '/api/v2/sessions/:id/telemetry',
    endpoint(async (req, res) => {
      const u = await principal(req),
        { s, m } = await membership(pool, uuid.parse(req.params.id), u.id);
      const d = z
        .object({
          event: z.enum([
            'HEARTBEAT',
            'MIC_MUTED',
            'CAMERA_DISABLED',
            'SCREEN_SHARE_STARTED',
            'SCREEN_SHARE_STOPPED',
            'CONNECTION_LOST',
            'RECONNECTED',
            'HELP_REQUESTED',
          ]),
          latency: z.number().min(0).max(60000).default(0),
          jitter: z.number().min(0).max(60000).default(0),
          loss: z.number().min(0).max(100).default(0),
          bitrate: z.number().min(0).max(100000000).default(0),
        })
        .strict()
        .parse(req.body);
      if (terminal.has(s.state)) throw new ServiceError(409, 'SESSION_ENDED');
      await pool.query(
        'UPDATE session_members SET last_seen=now() WHERE session_id=$1 AND account_id=$2',
        [s.id, u.id],
      );
      if (
        s.kind === 'TEXT' &&
        m.ready_at &&
        ['JOINABLE', 'IN_SESSION'].includes(s.state) &&
        roleFor(s, u.id)
      ) {
        assertWindow(s);
        await transaction(pool, async (db) => {
          const latest = (
            await db.query('SELECT * FROM live_sessions WHERE id=$1 FOR UPDATE', [s.id])
          ).rows[0] as Session;
          if (!['JOINABLE', 'IN_SESSION'].includes(latest.state)) return;
          await db.query(
            'UPDATE session_members SET connected=true,intentional_leave=false,joined_at=COALESCE(joined_at,now()) WHERE session_id=$1 AND account_id=$2',
            [s.id, u.id],
          );
          const started = await db.query(
            "UPDATE live_sessions SET state='IN_SESSION',actual_started_at=now() WHERE id=$1 AND state='JOINABLE' AND (SELECT count(*) FROM session_members WHERE session_id=$1 AND role IN ('CLIENT','EXPERT') AND connected AND last_seen>now()-interval '30 seconds')=2 RETURNING id",
            [s.id],
          );
          if (started.rowCount) {
            await audit(db, s.id, null, 'SESSION_STARTED', { source: 'TEXT_PRESENCE' });
            await notify(db, latest, 'SESSION_STARTED');
          }
        });
      }
      await pool.query(
        "INSERT INTO session_metrics(session_id,account_id,samples,latency_sum,jitter_sum,loss_sum,bitrate_sum) VALUES($1,$2,1,$3,$4,$5,$6) ON CONFLICT(session_id,account_id) DO UPDATE SET samples=session_metrics.samples+1,latency_sum=session_metrics.latency_sum+$3,jitter_sum=session_metrics.jitter_sum+$4,loss_sum=session_metrics.loss_sum+$5,bitrate_sum=session_metrics.bitrate_sum+$6,updated_at=now() WHERE session_metrics.updated_at<now()-interval '10 seconds'",
        [s.id, u.id, d.latency, d.jitter, d.loss, d.bitrate],
      );
      if (d.event !== 'HEARTBEAT')
        await audit(pool, s.id, u.id, d.event, { source: 'CLIENT_REPORTED' });
      res.json({ data: { ok: true } });
    }),
  );
  r.post(
    '/api/v2/sessions/:id/notes',
    endpoint(async (req, res) => {
      const u = await principal(req),
        { s, m } = await membership(pool, uuid.parse(req.params.id), u.id);
      if (m.role !== 'EXPERT') throw new ServiceError(403, 'FORBIDDEN');
      const d = z
        .object({
          visibility: z.enum(['PRIVATE_EXPERT_NOTE', 'SHARED_SESSION_NOTE']),
          body: z.string().max(20000),
        })
        .strict()
        .parse(req.body);
      await pool.query(
        'INSERT INTO session_notes(session_id,author_id,visibility,sealed_body) VALUES($1,$2,$3,$4) ON CONFLICT(session_id,author_id,visibility) DO UPDATE SET sealed_body=$4,updated_at=now()',
        [s.id, u.id, d.visibility, seal(d.body, s.id + ':' + u.id + ':' + d.visibility)],
      );
      res.json({ data: { ok: true } });
    }),
  );
  r.post(
    '/api/v2/sessions/:id/observers',
    endpoint(async (req, res) => {
      const u = await requirePermission(req, 'session.observe'),
        s = await load(pool, uuid.parse(req.params.id)),
        d = z
          .object({
            reason: z.string().trim().min(5).max(300),
            emergency: z.boolean().default(false),
          })
          .strict()
          .parse(req.body);
      assertWindow(s);
      if (s.policy.observer === 'NEVER') throw new ServiceError(403, 'OBSERVER_NOT_ALLOWED');
      if (d.emergency) {
        await requirePermission(req, 'session.emergency');
        if (s.policy.observer !== 'ADMIN_EMERGENCY_ONLY') throw new ServiceError(403, 'FORBIDDEN');
      }
      const id = randomUUID();
      await pool.query(
        'INSERT INTO session_observers(id,session_id,account_id,requested_by,emergency,reason) VALUES($1,$2,$3,$3,$4,$5)',
        [id, s.id, u.id, d.emergency, d.reason],
      );
      await audit(pool, s.id, u.id, 'OBSERVER_REQUESTED', {
        request_id: id,
        emergency: d.emergency,
      });
      res.json({ data: { id } });
    }),
  );
  r.post(
    '/api/v2/sessions/:id/observer-admit',
    endpoint(async (req, res) => {
      const u = await requirePermission(req, 'session.observe'),
        s = await load(pool, uuid.parse(req.params.id)),
        d = z.object({ request_id: uuid }).strict().parse(req.body),
        o = (
          await pool.query(
            'SELECT * FROM session_observers WHERE id=$1 AND session_id=$2 AND account_id=$3 AND NOT revoked',
            [d.request_id, s.id, u.id],
          )
        ).rows[0];
      if (!o) throw new ServiceError(403, 'FORBIDDEN');
      if (o.emergency) await requirePermission(req, 'session.emergency');
      assertWindow(s);
      const c = await observerConsent(s, o.id);
      if (!observerAllowed(s.policy, c.client, c.expert, o.emergency))
        throw new ServiceError(403, 'OBSERVER_CONSENT_REQUIRED');
      await pool.query(
        "INSERT INTO session_members(session_id,account_id,identity,role) VALUES($1,$2,$3,'OBSERVER') ON CONFLICT(session_id,account_id) DO UPDATE SET revoked=false,identity=EXCLUDED.identity WHERE session_members.role='OBSERVER'",
        [s.id, u.id, randomUUID()],
      );
      await audit(pool, s.id, u.id, 'OBSERVER_ADMITTED', { request_id: o.id });
      await notify(pool, s, 'OBSERVER_ADMITTED');
      res.json({ data: { ok: true } });
    }),
  );
  r.post(
    '/internal/sessions/:id/consent-authorize',
    endpoint(async (req, res) => {
      const u = await principal(req),
        s = await load(pool, uuid.parse(req.params.id)),
        d = z
          .object({ context_id: uuid, purpose: z.enum(['RECORDING', 'OBSERVER']) })
          .strict()
          .parse(req.body);
      if (!roleFor(s, u.id)) throw new ServiceError(403, 'FORBIDDEN');
      if (
        d.purpose === 'OBSERVER' &&
        !(
          await pool.query(
            'SELECT 1 FROM session_observers WHERE id=$1 AND session_id=$2 AND NOT revoked',
            [d.context_id, s.id],
          )
        ).rowCount
      )
        throw new ServiceError(404, 'NOT_FOUND');
      if (d.purpose === 'RECORDING' && (d.context_id !== s.id || s.policy.recording === 'OFF'))
        throw new ServiceError(403, 'RECORDING_NOT_ALLOWED');
      res.json({ data: { ok: true } });
    }),
  );
  r.post(
    '/api/v2/sessions/:id/observer-consent',
    endpoint(async (req, res) => {
      const u = await principal(req),
        { s } = await membership(pool, uuid.parse(req.params.id), u.id),
        d = z.object({ request_id: uuid, accepted: z.boolean() }).strict().parse(req.body);
      if (!roleFor(s, u.id)) throw new ServiceError(403, 'FORBIDDEN');
      await internalCall(
        'consent-service',
        '/internal/session-consent',
        req.get('authorization') ?? '',
        { session_id: s.id, context_id: d.request_id, purpose: 'OBSERVER', accepted: d.accepted },
      );
      if (!d.accepted) {
        const o = (
          await pool.query(
            'SELECT account_id FROM session_observers WHERE id=$1 AND session_id=$2',
            [d.request_id, s.id],
          )
        ).rows[0];
        if (o) {
          const m = (
            await pool.query(
              "UPDATE session_members SET revoked=true WHERE session_id=$1 AND account_id=$2 AND role='OBSERVER' RETURNING identity",
              [s.id, o.account_id],
            )
          ).rows[0];
          await pool.query('UPDATE session_observers SET revoked=true WHERE id=$1', [d.request_id]);
          if (m && s.kind !== 'TEXT') await rooms().removeParticipant(s.room_name, m.identity);
        }
      }
      res.json({ data: { ok: true } });
    }),
  );
  r.get(
    '/api/v2/sessions/:id/technical-report',
    endpoint(async (req, res) => {
      await requirePermission(req, 'session.monitor');
      const id = uuid.parse(req.params.id);
      await load(pool, id);
      res.json({
        data: {
          members: (
            await pool.query(
              'SELECT role,waiting_at,joined_at,left_at,connected,reconnects,device_check FROM session_members WHERE session_id=$1',
              [id],
            )
          ).rows,
          metrics: (
            await pool.query(
              'SELECT samples,latency_sum/GREATEST(samples,1) AS avg_latency,jitter_sum/GREATEST(samples,1) AS avg_jitter,loss_sum/GREATEST(samples,1) AS avg_loss,bitrate_sum/GREATEST(samples,1) AS avg_bitrate FROM session_metrics WHERE session_id=$1',
              [id],
            )
          ).rows,
          events: (
            await pool.query(
              'SELECT event,created_at FROM session_events WHERE session_id=$1 ORDER BY id DESC LIMIT 100',
              [id],
            )
          ).rows,
        },
      });
    }),
  );
  r.post(
    '/api/v2/sessions/:id/terminate',
    endpoint(async (req, res) => {
      const u = await requirePermission(req, 'session.manage');
      await requestEnd(pool, uuid.parse(req.params.id), u.id, 'TERMINATED_BY_ADMIN');
      res.json({ data: { state: 'ENDING' } });
    }),
  );
  r.get(
    '/internal/sessions/:id/evidence',
    endpoint(async (req, res) => {
      const s = await load(pool, uuid.parse(req.params.id));
      res.json({
        data: {
          id: s.id,
          booking_id: s.booking_id,
          client_id: s.client_id,
          expert_id: s.expert_id,
          state: s.state,
          actual_started_at: s.actual_started_at,
          actual_ended_at: s.actual_ended_at,
          end_reason: s.end_reason,
        },
      });
    }),
  );
  return r;
}
