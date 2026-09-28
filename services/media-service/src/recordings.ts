import type { Pool } from 'pg';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  S3Upload,
  EgressStatus,
} from 'livekit-server-sdk';
import {
  internalRouter,
  endpoint,
  principal,
  internalCall,
  ServiceError,
  transaction,
} from '@vianoor/service-runtime';
import { livekitConfig } from './livekit.js';
import { load, membership, audit, notify } from './model.js';
import { roleFor, type Session } from './policy.js';
const uuid = z.string().uuid();
const active = ['STARTING', 'ACTIVE', 'STOP_REQUESTED', 'UNKNOWN', 'FINALIZING'];
const egress = () => {
  if (process.env.LIVEKIT_EGRESS_ENABLED !== '1')
    throw new ServiceError(503, 'RECORDING_NOT_CONFIGURED');
  const c = livekitConfig();
  return new EgressClient(c.url, c.key, c.secret);
};
export async function recordingConsent(s: Session) {
  const rows = await internalCall<{ account_id: string; accepted: boolean }[]>(
    'consent-service',
    '/internal/session-consents',
    '',
    { session_id: s.id, context_id: s.id, purpose: 'RECORDING' },
  );
  return (
    s.policy.recording === 'BOTH_CONSENT' &&
    !!rows.find((x) => x.account_id === s.client_id)?.accepted &&
    !!rows.find((x) => x.account_id === s.expert_id)?.accepted
  );
}
export function recordingsRouter(pool: Pool) {
  const r = internalRouter();
  r.get(
    '/api/v2/sessions/:id/recordings',
    endpoint(async (req, res) => {
      const u = await principal(req),
        { s } = await membership(pool, uuid.parse(req.params.id), u.id);
      if (!roleFor(s, u.id)) throw new ServiceError(403, 'FORBIDDEN');
      res.json({
        data: {
          enabled: process.env.LIVEKIT_EGRESS_ENABLED === '1',
          download: s.policy.recording_download,
          consented: await recordingConsent(s),
          items: (
            await pool.query(
              'SELECT id,state,file_id,created_at,expires_at FROM session_recordings WHERE session_id=$1 ORDER BY created_at DESC',
              [s.id],
            )
          ).rows,
        },
      });
    }),
  );
  r.post(
    '/api/v2/sessions/:id/recording/consent',
    endpoint(async (req, res) => {
      const u = await principal(req),
        { s } = await membership(pool, uuid.parse(req.params.id), u.id),
        d = z.object({ accepted: z.boolean() }).strict().parse(req.body);
      if (!roleFor(s, u.id) || s.policy.recording === 'OFF')
        throw new ServiceError(403, 'FORBIDDEN');
      await transaction(pool, async (db) => {
        await db.query('SELECT id FROM live_sessions WHERE id=$1 FOR UPDATE', [s.id]);
        await internalCall(
          'consent-service',
          '/internal/session-consent',
          req.get('authorization') ?? '',
          { session_id: s.id, context_id: s.id, purpose: 'RECORDING', accepted: d.accepted },
        );
        if (!d.accepted)
          await db.query(
            "UPDATE session_recordings SET state='STOP_REQUESTED' WHERE session_id=$1 AND state=ANY($2)",
            [s.id, active],
          );
        await audit(
          db,
          s.id,
          u.id,
          d.accepted ? 'RECORDING_CONSENT_GIVEN' : 'RECORDING_CONSENT_WITHDRAWN',
        );
      });
      res.json({ data: { ok: true } });
    }),
  );
  r.post(
    '/api/v2/sessions/:id/recording/start',
    endpoint(async (req, res) => {
      const u = await principal(req),
        { s, m } = await membership(pool, uuid.parse(req.params.id), u.id);
      if (m.role !== 'EXPERT') throw new ServiceError(403, 'FORBIDDEN');
      const client = egress();
      const id = await transaction(pool, async (db) => {
        const latest = (
          await db.query('SELECT * FROM live_sessions WHERE id=$1 FOR UPDATE', [s.id])
        ).rows[0] as Session;
        if (latest.state !== 'IN_SESSION' || latest.kind === 'TEXT')
          throw new ServiceError(409, 'SESSION_NOT_RECORDABLE');
        if (!(await recordingConsent(latest)))
          throw new ServiceError(403, 'RECORDING_CONSENT_REQUIRED');
        if (
          (
            await db.query(
              'SELECT 1 FROM session_recordings WHERE session_id=$1 AND state=ANY($2)',
              [s.id, active],
            )
          ).rowCount
        )
          throw new ServiceError(409, 'RECORDING_ALREADY_PENDING');
        const id = randomUUID();
        await db.query(
          "INSERT INTO session_recordings(id,session_id,state,expires_at) VALUES($1,$2,'STARTING',now()+($3*interval '1 day'))",
          [id, s.id, s.policy.retention_days],
        );
        await audit(db, s.id, u.id, 'RECORDING_REQUESTED', { recording_id: id });
        return id;
      });
      let dispatched = false;
      try {
        const target = await internalCall<{
          filepath: string;
          bucket: string;
          region: string;
          endpoint: string;
          accessKey: string;
          secret: string;
        }>('file-service', '/internal/recordings/prepare', '', {
          recording_id: id,
          session_id: s.id,
        });
        dispatched = true;
        const info = await client.startRoomCompositeEgress(
          s.room_name,
          {
            file: new EncodedFileOutput({
              fileType: EncodedFileType.MP4,
              filepath: target.filepath,
              output: {
                case: 's3',
                value: new S3Upload({
                  accessKey: target.accessKey,
                  secret: target.secret,
                  bucket: target.bucket,
                  region: target.region,
                  endpoint: target.endpoint,
                  forcePathStyle: true,
                }),
              },
            }),
          },
          { audioOnly: s.kind === 'AUDIO' },
        );
        await pool.query(
          "UPDATE session_recordings SET egress_id=$2,state=CASE WHEN state='STOP_REQUESTED' THEN state ELSE 'ACTIVE' END WHERE id=$1",
          [id, info.egressId],
        );
        await audit(pool, s.id, u.id, 'RECORDING_STARTED', { recording_id: id });
        await notify(pool, s, 'RECORDING_STARTED');
        res.json({ data: { id, state: 'ACTIVE' } });
      } catch {
        await pool.query(
          "UPDATE session_recordings SET state=CASE WHEN $2='FAILED' THEN 'FAILED' WHEN state='STOP_REQUESTED' THEN state ELSE 'UNKNOWN' END WHERE id=$1",
          [id, dispatched ? 'UNKNOWN' : 'FAILED'],
        );
        throw new ServiceError(
          503,
          dispatched ? 'RECORDING_START_UNCERTAIN' : 'RECORDING_STORAGE_UNAVAILABLE',
        );
      }
    }),
  );
  r.post(
    '/api/v2/sessions/:id/recording/stop',
    endpoint(async (req, res) => {
      const u = await principal(req),
        { s } = await membership(pool, uuid.parse(req.params.id), u.id);
      if (!roleFor(s, u.id)) throw new ServiceError(403, 'FORBIDDEN');
      await pool.query(
        "UPDATE session_recordings SET state='STOP_REQUESTED' WHERE session_id=$1 AND state=ANY($2)",
        [s.id, active],
      );
      await audit(pool, s.id, u.id, 'RECORDING_STOP_REQUESTED');
      res.json({ data: { state: 'STOP_REQUESTED' } });
    }),
  );
  r.get(
    '/internal/recordings/:id/permit',
    endpoint(async (req, res) => {
      const recording = (
        await pool.query('SELECT * FROM session_recordings WHERE id=$1', [
          uuid.parse(req.params.id),
        ])
      ).rows[0];
      if (!recording) throw new ServiceError(404, 'NOT_FOUND');
      const s = await load(pool, recording.session_id);
      if (s.policy.recording === 'OFF') throw new ServiceError(403, 'FORBIDDEN');
      res.json({
        data: {
          session_id: s.id,
          state: recording.state,
          expires_at: recording.expires_at,
          download: s.policy.recording_download,
        },
      });
    }),
  );
  r.post(
    '/internal/recordings/:id/authorize',
    endpoint(async (req, res) => {
      const u = await principal(req),
        d = z.object({ download: z.boolean() }).strict().parse(req.body),
        recording = (
          await pool.query('SELECT * FROM session_recordings WHERE id=$1', [
            uuid.parse(req.params.id),
          ])
        ).rows[0];
      if (
        !recording ||
        recording.state !== 'READY' ||
        new Date(recording.expires_at).getTime() <= Date.now()
      )
        throw new ServiceError(404, 'NOT_FOUND');
      const s = await load(pool, recording.session_id);
      if (!roleFor(s, u.id) || (d.download && !s.policy.recording_download))
        throw new ServiceError(403, 'FORBIDDEN');
      await audit(pool, s.id, u.id, d.download ? 'RECORDING_DOWNLOAD' : 'RECORDING_VIEW', {
        recording_id: recording.id,
      });
      res.json({ data: { ok: true } });
    }),
  );
  return r;
}
export async function recordingTick(pool: Pool) {
  if (process.env.LIVEKIT_EGRESS_ENABLED !== '1') return;
  const client = egress();
  for (const recording of (
    await pool.query(
      'SELECT * FROM session_recordings WHERE state=ANY($1) ORDER BY created_at LIMIT 30',
      [active],
    )
  ).rows) {
    try {
      const s = await load(pool, recording.session_id),
        items = await client.listEgress({ roomName: s.room_name });
      const item = items.find(
        (e) =>
          e.egressId === recording.egress_id ||
          (!recording.egress_id &&
            (e.fileResults.some((f) => f.filename === 'recordings/' + recording.id + '.mp4') ||
              (e.request.case === 'roomComposite' &&
                e.request.value.fileOutputs.some(
                  (f) => f.filepath === 'recordings/' + recording.id + '.mp4',
                )))),
      );
      if (!item) continue;
      if (!recording.egress_id)
        await pool.query('UPDATE session_recordings SET egress_id=$2 WHERE id=$1', [
          recording.id,
          item.egressId,
        ]);
      if ([EgressStatus.EGRESS_STARTING, EgressStatus.EGRESS_ACTIVE].includes(item.status)) {
        if (
          recording.state === 'STOP_REQUESTED' ||
          s.state !== 'IN_SESSION' ||
          !(await recordingConsent(s))
        )
          await client.stopEgress(item.egressId);
        else
          await pool.query(
            "UPDATE session_recordings SET state='ACTIVE' WHERE id=$1 AND state IN ('STARTING','UNKNOWN')",
            [recording.id],
          );
        continue;
      }
      if (item.status === EgressStatus.EGRESS_COMPLETE) {
        await pool.query("UPDATE session_recordings SET state='FINALIZING' WHERE id=$1", [
          recording.id,
        ]);
        const file = await internalCall<{ id: string }>(
          'file-service',
          '/internal/recordings/complete',
          '',
          { recording_id: recording.id },
        );
        await pool.query("UPDATE session_recordings SET state='READY',file_id=$2 WHERE id=$1", [
          recording.id,
          file.id,
        ]);
        await audit(pool, s.id, null, 'RECORDING_STOPPED', { recording_id: recording.id });
        await notify(pool, s, 'RECORDING_STOPPED');
      } else if (
        [
          EgressStatus.EGRESS_FAILED,
          EgressStatus.EGRESS_ABORTED,
          EgressStatus.EGRESS_LIMIT_REACHED,
        ].includes(item.status)
      ) {
        await pool.query("UPDATE session_recordings SET state='FAILED' WHERE id=$1", [
          recording.id,
        ]);
      }
    } catch {
      /* Reconcile using provider facts; never blindly restart ambiguous recordings. */
    }
  }
}
