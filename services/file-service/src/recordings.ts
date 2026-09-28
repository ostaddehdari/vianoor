import { z } from 'zod';
import type { Pool } from 'pg';
import { Readable } from 'node:stream';
import { internalRouter, endpoint, internalCall, ServiceError } from '@vianoor/service-runtime';
import { recordingObject, deleteObject } from './object-store.js';
const uuid = z.string().uuid();
export async function initializeRecordings(pool: Pool) {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS private_recordings(id uuid PRIMARY KEY,session_id uuid NOT NULL,object_key text NOT NULL UNIQUE,state text NOT NULL DEFAULT 'PENDING',bytes bigint,expires_at timestamptz NOT NULL,deleted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());",
  );
}
export function privateRecordingsRouter(pool: Pool) {
  const r = internalRouter();
  r.post(
    '/internal/recordings/prepare',
    endpoint(async (req, res) => {
      const d = z.object({ recording_id: uuid, session_id: uuid }).strict().parse(req.body),
        permit = await internalCall<{ session_id: string; state: string; expires_at: string }>(
          'media-service',
          '/internal/recordings/' + d.recording_id + '/permit',
        );
      if (permit.session_id !== d.session_id || permit.state !== 'STARTING')
        throw new ServiceError(403, 'FORBIDDEN');
      const accessKey = process.env.RECORDINGS_S3_ACCESS_KEY,
        secret = process.env.RECORDINGS_S3_SECRET_KEY,
        bucket = process.env.S3_BUCKET,
        endpoint = process.env.RECORDINGS_S3_ENDPOINT ?? process.env.S3_ENDPOINT;
      if (!accessKey || !secret || !bucket || !endpoint)
        throw new ServiceError(503, 'RECORDING_STORAGE_NOT_CONFIGURED');
      const filepath = 'recordings/' + d.recording_id + '.mp4';
      await pool.query(
        'INSERT INTO private_recordings(id,session_id,object_key,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',
        [d.recording_id, d.session_id, filepath, permit.expires_at],
      );
      res.json({
        data: {
          filepath,
          bucket,
          endpoint,
          accessKey,
          secret,
          region: process.env.S3_REGION ?? 'us-east-1',
        },
      });
    }),
  );
  r.post(
    '/internal/recordings/complete',
    endpoint(async (req, res) => {
      const d = z.object({ recording_id: uuid }).strict().parse(req.body),
        row = (
          await pool.query('SELECT * FROM private_recordings WHERE id=$1 AND deleted_at IS NULL', [
            d.recording_id,
          ])
        ).rows[0];
      if (!row) throw new ServiceError(404, 'NOT_FOUND');
      const permit = await internalCall<{ session_id: string }>(
        'media-service',
        '/internal/recordings/' + row.id + '/permit',
      );
      if (permit.session_id !== row.session_id) throw new ServiceError(403, 'FORBIDDEN');
      const object = await recordingObject(row.object_key, 'bytes=0-63');
      const first = Buffer.from(await object.Body!.transformToByteArray());
      if (first.subarray(4, 8).toString() !== 'ftyp')
        throw new ServiceError(409, 'INVALID_RECORDING');
      const size = Number(object.ContentRange?.split('/')[1]);
      if (!Number.isSafeInteger(size) || size <= 0)
        throw new ServiceError(409, 'INVALID_RECORDING');
      await pool.query("UPDATE private_recordings SET state='READY',bytes=$2 WHERE id=$1", [
        row.id,
        size,
      ]);
      res.json({ data: { id: row.id } });
    }),
  );
  r.get(
    '/api/v2/files/recordings/:id/stream',
    endpoint(async (req, res) => {
      const id = uuid.parse(req.params.id),
        download = z.enum(['0', '1']).parse(req.query.download ?? '0'),
        row = (
          await pool.query(
            "SELECT * FROM private_recordings WHERE id=$1 AND state='READY' AND deleted_at IS NULL AND expires_at>now()",
            [id],
          )
        ).rows[0];
      if (!row) throw new ServiceError(404, 'NOT_FOUND');
      await internalCall(
        'media-service',
        '/internal/recordings/' + id + '/authorize',
        req.get('authorization') ?? '',
        { download: download === '1' },
      );
      let range = req.get('range');
      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (!match) throw new ServiceError(416, 'INVALID_RANGE');
        const start = Number(match[1]),
          end = match[2] ? Number(match[2]) : Number(row.bytes) - 1;
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          start >= Number(row.bytes)
        )
          throw new ServiceError(416, 'INVALID_RANGE');
        range =
          'bytes=' +
          start +
          '-' +
          Math.min(end, start + 4 * 1024 * 1024 - 1, Number(row.bytes) - 1);
      }
      const object = await recordingObject(row.object_key, range);
      res.status(range ? 206 : 200);
      res.set({
        'Content-Type': 'video/mp4',
        'Cache-Control': 'private, no-store',
        'Accept-Ranges': 'bytes',
        'Content-Disposition':
          (download === '1' ? 'attachment' : 'inline') + '; filename="session-recording.mp4"',
        'X-Content-Type-Options': 'nosniff',
      });
      if (object.ContentRange) res.set('Content-Range', object.ContentRange);
      if (object.ContentLength !== undefined)
        res.set('Content-Length', String(object.ContentLength));
      const body = object.Body as Readable;
      res.on('close', () => body.destroy());
      body.on('error', () => res.destroy());
      body.pipe(res);
    }),
  );
  return r;
}
export async function expireRecordings(pool: Pool) {
  for (const row of (
    await pool.query(
      'SELECT id,object_key FROM private_recordings WHERE expires_at<=now() AND deleted_at IS NULL LIMIT 20',
    )
  ).rows) {
    try {
      await deleteObject(row.object_key);
      await pool.query(
        "UPDATE private_recordings SET deleted_at=now(),state='DELETED' WHERE id=$1",
        [row.id],
      );
    } catch {
      /* Retry deletion, while authorization already denies expired files. */
    }
  }
}
