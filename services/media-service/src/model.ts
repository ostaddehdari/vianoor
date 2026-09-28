import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  internalCall,
  ServiceError,
  transaction,
  sealJson,
  openJson,
} from '@vianoor/service-runtime';
import {
  policySchema,
  roleFor,
  assertEligible,
  terminal,
  type Session,
  type BookingContext,
} from './policy.js';
export const seal = (v: unknown, id: string) =>
  sealJson(v, 'session:' + id, 'SESSION_ENCRYPTION_KEY');
export const open = (v: string, id: string) =>
  openJson(v, 'session:' + id, 'SESSION_ENCRYPTION_KEY');
export async function initializeMedia(pool: Pool) {
  await pool.query(`
CREATE TABLE IF NOT EXISTS live_sessions(id uuid PRIMARY KEY,booking_id uuid NOT NULL UNIQUE,client_id uuid NOT NULL,expert_id uuid NOT NULL,room_name text NOT NULL UNIQUE,state text NOT NULL DEFAULT 'BOOKED',kind text NOT NULL,title text NOT NULL,expert_name text NOT NULL,scheduled_start timestamptz NOT NULL,scheduled_end timestamptz NOT NULL,actual_started_at timestamptz,actual_ended_at timestamptz,policy jsonb NOT NULL,end_reason text,revision int NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS live_sessions_schedule ON live_sessions(scheduled_start,state);
CREATE TABLE IF NOT EXISTS session_members(session_id uuid REFERENCES live_sessions(id),account_id uuid NOT NULL,identity uuid NOT NULL UNIQUE,role text NOT NULL,waiting_at timestamptz,ready_at timestamptz,device_check jsonb,joined_at timestamptz,left_at timestamptz,last_seen timestamptz,connection_sid text,last_event_at bigint NOT NULL DEFAULT 0,connected boolean NOT NULL DEFAULT false,intentional_leave boolean NOT NULL DEFAULT false,reconnects int NOT NULL DEFAULT 0,revoked boolean NOT NULL DEFAULT false,PRIMARY KEY(session_id,account_id));
CREATE TABLE IF NOT EXISTS session_events(id bigserial PRIMARY KEY,session_id uuid NOT NULL,account_id uuid,event text NOT NULL,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS session_webhooks(id text PRIMARY KEY,raw_sealed text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS session_outbox(id uuid PRIMARY KEY,session_id uuid NOT NULL,account_id uuid,event text NOT NULL,target text NOT NULL,delivered_at timestamptz,UNIQUE(session_id,account_id,event,target));
CREATE TABLE IF NOT EXISTS session_notes(session_id uuid REFERENCES live_sessions(id),author_id uuid NOT NULL,visibility text NOT NULL,sealed_body text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(session_id,author_id,visibility));
CREATE TABLE IF NOT EXISTS session_metrics(session_id uuid REFERENCES live_sessions(id),account_id uuid NOT NULL,samples int NOT NULL DEFAULT 0,latency_sum double precision NOT NULL DEFAULT 0,jitter_sum double precision NOT NULL DEFAULT 0,loss_sum double precision NOT NULL DEFAULT 0,bitrate_sum double precision NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(session_id,account_id));
CREATE TABLE IF NOT EXISTS session_observers(id uuid PRIMARY KEY,session_id uuid REFERENCES live_sessions(id),account_id uuid NOT NULL,requested_by uuid NOT NULL,emergency boolean NOT NULL DEFAULT false,reason text NOT NULL,revoked boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS session_recordings(id uuid PRIMARY KEY,session_id uuid NOT NULL REFERENCES live_sessions(id),state text NOT NULL,egress_id text UNIQUE,file_id uuid,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL);
`);
}
export async function audit(
  db: Pool | PoolClient,
  s: string,
  actor: string | null,
  event: string,
  details: unknown = {},
) {
  await db.query(
    'INSERT INTO session_events(session_id,account_id,event,details) VALUES($1,$2,$3,$4)',
    [s, actor, event, details],
  );
}
export async function context(id: string) {
  return internalCall<BookingContext>(
    'booking-service',
    '/internal/bookings/session-context/' + id,
  );
}
export async function provision(pool: Pool, b: BookingContext, account: string) {
  if (!roleFor(b, account)) throw new ServiceError(403, 'FORBIDDEN');
  assertEligible(b);
  return transaction(pool, async (db) => {
    let s = (await db.query('SELECT * FROM live_sessions WHERE booking_id=$1 FOR UPDATE', [b.id]))
      .rows[0] as Session | undefined;
    if (!s) {
      s = (
        await db.query(
          'INSERT INTO live_sessions(id,booking_id,client_id,expert_id,room_name,kind,title,expert_name,scheduled_start,scheduled_end,policy) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(booking_id) DO UPDATE SET booking_id=EXCLUDED.booking_id RETURNING *',
          [
            randomUUID(),
            b.id,
            b.client_id,
            b.expert_id,
            'vn_' + randomUUID().replaceAll('-', ''),
            b.kind,
            b.title,
            b.expert_name,
            b.start_at,
            b.end_at,
            policySchema.parse(b.call_policy ?? {}),
          ],
        )
      ).rows[0] as Session;
      for (const [a, role] of [
        [b.client_id, 'CLIENT'],
        [b.expert_id, 'EXPERT'],
      ])
        await db.query(
          'INSERT INTO session_members(session_id,account_id,identity,role) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [s.id, a, randomUUID(), role],
        );
    }
    // Schedule changes are reconciled by the worker after revoking the old room.
    return s;
  });
}
export async function load(pool: Pool | PoolClient, id: string) {
  const s = (await pool.query('SELECT * FROM live_sessions WHERE id=$1', [id])).rows[0] as
    | Session
    | undefined;
  if (!s) throw new ServiceError(404, 'NOT_FOUND');
  return s;
}
export async function membership(pool: Pool, id: string, account: string) {
  const s = await load(pool, id),
    m = (
      await pool.query(
        'SELECT * FROM session_members WHERE session_id=$1 AND account_id=$2 AND NOT revoked',
        [id, account],
      )
    ).rows[0];
  if (!m) throw new ServiceError(403, 'FORBIDDEN');
  return { s, m };
}
export async function notify(db: Pool | PoolClient, s: Session, event: string) {
  for (const a of [s.client_id, s.expert_id])
    await db.query(
      "INSERT INTO session_outbox(id,session_id,account_id,event,target) VALUES($1,$2,$3,$4,'NOTIFICATION') ON CONFLICT DO NOTHING",
      [randomUUID(), s.id, a, event],
    );
}
export async function requestEnd(pool: Pool, id: string, actor: string, reason: string) {
  return transaction(pool, async (db) => {
    const s = (await db.query('SELECT * FROM live_sessions WHERE id=$1 FOR UPDATE', [id]))
      .rows[0] as Session;
    if (!s) throw new ServiceError(404, 'NOT_FOUND');
    if (terminal.has(s.state) || s.state === 'ENDING') return s;
    await db.query(
      "UPDATE live_sessions SET state='ENDING',end_reason=$2,actual_ended_at=now(),revision=revision+1 WHERE id=$1",
      [id, reason],
    );
    await audit(db, id, actor, 'SESSION_END_REQUESTED', { reason });
    return s;
  });
}
