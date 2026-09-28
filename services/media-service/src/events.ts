import { randomUUID } from 'node:crypto';
import { Router, text } from 'express';
import type { Pool } from 'pg';
import { transaction, internalCall, ServiceError } from '@vianoor/service-runtime';
import { receiver, rooms } from './livekit.js';
import { audit, notify, seal, context, requestEnd } from './model.js';
import { assertEligible, assertWindow, terminal, type Session } from './policy.js';
export function mediaWebhook(pool: Pool) {
  const r = Router();
  r.post(
    '/webhooks/livekit',
    text({
      type: ['application/webhook+json', 'application/json'],
      limit: '256kb',
      inflate: false,
    }),
    async (req, res) => {
      let event;
      try {
        if (typeof req.body !== 'string' || !req.get('authorization')) throw Error();
        event = await receiver().receive(req.body, req.get('authorization'));
      } catch {
        res.status(401).json({ error: { code: 'INVALID_WEBHOOK' } });
        return;
      }
      if (!event.id) {
        res.status(400).json({ error: { code: 'INVALID_WEBHOOK' } });
        return;
      }
      try {
        const s = (
          await pool.query('SELECT * FROM live_sessions WHERE room_name=$1', [
            event.room?.name ?? '',
          ])
        ).rows[0] as Session | undefined;
        if (s && event.event === 'participant_joined' && event.participant) {
          const m = (
            await pool.query(
              'SELECT * FROM session_members WHERE session_id=$1 AND identity=$2 AND NOT revoked',
              [s.id, event.participant.identity],
            )
          ).rows[0];
          let allowed = !!m;
          try {
            assertEligible(await context(s.booking_id));
            assertWindow(s);
            if (!['JOINABLE', 'IN_SESSION'].includes(s.state)) allowed = false;
          } catch {
            allowed = false;
          }
          if (!allowed) {
            await rooms().removeParticipant(s.room_name, event.participant.identity);
            res.json({ ok: true });
            return;
          }
        }
        await transaction(pool, async (db) => {
          if (
            !(
              await db.query(
                'INSERT INTO session_webhooks(id,raw_sealed) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id',
                [event.id, seal(req.body, 'webhook:' + event.id)],
              )
            ).rowCount
          )
            return;
          if (!s) return;
          await db.query('SELECT id FROM live_sessions WHERE id=$1 FOR UPDATE', [s.id]);
          const p = event.participant,
            t = Number(event.createdAt ?? 0);
          if (p && ['participant_joined', 'participant_left'].includes(event.event)) {
            const m = (
              await db.query(
                'SELECT * FROM session_members WHERE session_id=$1 AND identity=$2 FOR UPDATE',
                [s.id, p.identity],
              )
            ).rows[0];
            if (m && t >= Number(m.last_event_at)) {
              if (event.event === 'participant_joined') {
                await db.query(
                  'UPDATE session_members SET connected=true,joined_at=COALESCE(joined_at,to_timestamp($3)),left_at=NULL,last_seen=now(),last_event_at=$3,connection_sid=$4,intentional_leave=false,reconnects=reconnects+CASE WHEN joined_at IS NOT NULL AND NOT connected THEN 1 ELSE 0 END WHERE session_id=$1 AND account_id=$2',
                  [s.id, m.account_id, t, p.sid],
                );
                await audit(
                  db,
                  s.id,
                  m.account_id,
                  m.role === 'OBSERVER' ? 'OBSERVER_JOINED' : 'PARTICIPANT_JOINED',
                  { source: 'LIVEKIT' },
                );
              } else if (!m.connection_sid || m.connection_sid === p.sid) {
                await db.query(
                  'UPDATE session_members SET connected=false,left_at=to_timestamp($3),last_event_at=$3 WHERE session_id=$1 AND account_id=$2',
                  [s.id, m.account_id, t],
                );
                await audit(
                  db,
                  s.id,
                  m.account_id,
                  m.intentional_leave ? 'PARTICIPANT_LEFT' : 'CONNECTION_LOST',
                  { source: 'LIVEKIT' },
                );
              }
            }
          }
          if (['track_published', 'track_unpublished'].includes(event.event)) {
            await audit(
              db,
              s.id,
              null,
              event.event === 'track_published' ? 'TRACK_PUBLISHED' : 'TRACK_UNPUBLISHED',
              { source: 'LIVEKIT', source_type: event.track?.source },
            );
          }
          const started = await db.query(
            "UPDATE live_sessions SET state='IN_SESSION',actual_started_at=COALESCE(actual_started_at,now()) WHERE id=$1 AND state='JOINABLE' AND (SELECT count(*) FROM session_members WHERE session_id=$1 AND role IN ('CLIENT','EXPERT') AND connected AND NOT revoked)=2 RETURNING id",
            [s.id],
          );
          if (started.rowCount) {
            await audit(db, s.id, null, 'SESSION_STARTED');
            await notify(db, s, 'SESSION_STARTED');
          }
        });
        res.json({ ok: true });
      } catch {
        res.status(503).json({ error: { code: 'RETRY_WEBHOOK' } });
      }
    },
  );
  return r;
}
export async function mediaTick(pool: Pool) {
  for (const s of (
    await pool.query(
      "SELECT * FROM live_sessions WHERE state NOT IN ('COMPLETED','CANCELLED','NO_SHOW_USER','NO_SHOW_EXPERT','TECHNICAL_FAILURE','INTERRUPTED','TERMINATED_BY_ADMIN') ORDER BY scheduled_start LIMIT 200",
    )
  ).rows as Session[]) {
    try {
      const b = await context(s.booking_id);
      if (
        !s.actual_started_at &&
        new Date(b.start_at).getTime() !== new Date(s.scheduled_start).getTime() &&
        s.state !== 'ENDING'
      ) {
        if (s.kind !== 'TEXT') {
          try {
            await rooms().deleteRoom(s.room_name);
          } catch (e) {
            if ((e as { code?: string }).code !== 'not_found') throw e;
          }
        }
        await pool.query(
          "UPDATE live_sessions SET scheduled_start=$2,scheduled_end=$3,room_name=$4,state='BOOKED',revision=revision+1 WHERE id=$1",
          [s.id, b.start_at, b.end_at, 'vn_' + randomUUID().replaceAll('-', '')],
        );
        await pool.query(
          'UPDATE session_members SET ready_at=NULL,waiting_at=NULL,connected=false WHERE session_id=$1',
          [s.id],
        );
        continue;
      }

      if (['CANCELLED', 'EXPIRED'].includes(b.status) && s.state !== 'ENDING')
        await requestEnd(pool, s.id, s.expert_id, 'CANCELLED');
      if (s.state === 'ENDING') {
        if (s.kind !== 'TEXT') {
          try {
            await rooms().deleteRoom(s.room_name);
          } catch (e) {
            if ((e as { code?: string }).code !== 'not_found') throw e;
          }
        }
        // Keep completion pending until recording has stopped and storage reconciliation finishes.
        if (
          (
            await pool.query(
              "SELECT 1 FROM session_recordings WHERE session_id=$1 AND state IN ('STARTING','ACTIVE','UNKNOWN','STOP_REQUESTED') LIMIT 1",
              [s.id],
            )
          ).rowCount
        )
          continue;
        await transaction(pool, async (db) => {
          const row = (await db.query('SELECT * FROM live_sessions WHERE id=$1 FOR UPDATE', [s.id]))
            .rows[0] as Session;
          if (row.state !== 'ENDING') return;
          const state = ['COMPLETED', 'FOLLOW_UP_REQUIRED'].includes(row.end_reason ?? '')
            ? 'COMPLETED'
            : (row.end_reason ?? 'INTERRUPTED');
          if (!terminal.has(state)) throw new ServiceError(409, 'INVALID_OUTCOME');
          await db.query('UPDATE live_sessions SET state=$2,revision=revision+1 WHERE id=$1', [
            s.id,
            state,
          ]);
          await db.query(
            'UPDATE session_members SET connected=false,left_at=COALESCE(left_at,now()) WHERE session_id=$1',
            [s.id],
          );
          await audit(db, s.id, null, 'SESSION_ENDED', { state });
          await notify(db, s, 'SESSION_ENDED');
          if (state === 'COMPLETED')
            await db.query(
              "INSERT INTO session_outbox(id,session_id,account_id,event,target) VALUES(gen_random_uuid(),$1,$2,'SESSION_COMPLETED','BOOKING') ON CONFLICT DO NOTHING",
              [s.id, s.client_id],
            );
        });
        continue;
      }
      if (Date.now() >= Date.parse(s.scheduled_end) + s.policy.join_grace_minutes * 60000) {
        const connected = Number(
          (
            await pool.query(
              "SELECT count(*) FROM session_members WHERE session_id=$1 AND role IN ('CLIENT','EXPERT') AND connected",
              [s.id],
            )
          ).rows[0].count,
        );
        await requestEnd(
          pool,
          s.id,
          s.expert_id,
          s.actual_started_at
            ? connected === 2
              ? 'COMPLETED'
              : 'INTERRUPTED'
            : 'TECHNICAL_FAILURE',
        );
        continue;
      }
      if (
        !s.actual_started_at &&
        Date.now() >= Date.parse(s.scheduled_start) + s.policy.no_show_minutes * 60000
      ) {
        if (s.kind !== 'TEXT') {
          let active: Awaited<ReturnType<ReturnType<typeof rooms>['listParticipants']>>;
          try {
            active = await rooms().listParticipants(s.room_name);
          } catch (e) {
            if ((e as { code?: string }).code !== 'not_found') throw e;
            active = [];
          }
          await transaction(pool, async (db) => {
            await db.query('SELECT id FROM live_sessions WHERE id=$1 FOR UPDATE', [s.id]);
            for (const p of active)
              await db.query(
                "UPDATE session_members SET connected=true,joined_at=COALESCE(joined_at,now()),connection_sid=$3,last_seen=now() WHERE session_id=$1 AND identity=$2 AND NOT revoked AND role IN ('CLIENT','EXPERT')",
                [s.id, p.identity, p.sid],
              );
            const started = await db.query(
              "UPDATE live_sessions SET state='IN_SESSION',actual_started_at=now() WHERE id=$1 AND state='JOINABLE' AND (SELECT count(*) FROM session_members WHERE session_id=$1 AND identity=ANY($2) AND role IN ('CLIENT','EXPERT') AND NOT revoked)=2 RETURNING id",
              [s.id, active.map((p) => p.identity)],
            );
            if (started.rowCount) {
              await audit(db, s.id, null, 'SESSION_STARTED', { source: 'LIVEKIT_RECONCILIATION' });
              await notify(db, s, 'SESSION_STARTED');
            }
          });
          const fresh = (
            await pool.query('SELECT actual_started_at FROM live_sessions WHERE id=$1', [s.id])
          ).rows[0];
          if (fresh.actual_started_at) continue;
        }
        const members = (
          await pool.query(
            "SELECT role,joined_at FROM session_members WHERE session_id=$1 AND role IN ('CLIENT','EXPERT')",
            [s.id],
          )
        ).rows;
        const expert = members.find((m) => m.role === 'EXPERT')?.joined_at,
          client = members.find((m) => m.role === 'CLIENT')?.joined_at;
        await requestEnd(
          pool,
          s.id,
          s.expert_id,
          !expert ? 'NO_SHOW_EXPERT' : !client ? 'NO_SHOW_USER' : 'TECHNICAL_FAILURE',
        );
      }
    } catch {
      /* Retry when the owner or SFU is reachable; outages are not evidence of absence. */
    }
  }
  for (const item of (
    await pool.query('SELECT * FROM session_outbox WHERE delivered_at IS NULL ORDER BY id LIMIT 40')
  ).rows) {
    try {
      if (item.target === 'NOTIFICATION')
        await internalCall('notification-service', '/internal/notifications', '', {
          id: item.id,
          account_id: item.account_id,
          event: item.event,
          category: 'BOOKINGS',
          context_id: item.session_id,
        });
      else {
        const s = (
          await pool.query('SELECT booking_id FROM live_sessions WHERE id=$1', [item.session_id])
        ).rows[0];
        await internalCall('booking-service', '/internal/bookings/session-completed', '', {
          session_id: item.session_id,
          booking_id: s.booking_id,
        });
      }
      await pool.query('UPDATE session_outbox SET delivered_at=now() WHERE id=$1', [item.id]);
    } catch {
      /* Durable outbox retries without changing source facts. */
    }
  }
}
