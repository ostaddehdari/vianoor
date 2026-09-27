import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import type { Request } from 'express';
import { z } from 'zod';
import sharp from 'sharp';
import {
  internalRouter,
  endpoint,
  principal,
  requirePermission,
  internalCall,
  ServiceError,
  transaction,
} from '@vianoor/service-runtime';
import { putObject, getObject } from './object-store.js';
import { scan } from './scanner.js';
const maxTransport = 28 * 1024 * 1024;
export function validateSignature(bytes: Buffer, name: string, mime: string) {
  const ext = name.toLowerCase().split('.').pop();
  if (
    mime === 'application/pdf' &&
    ext === 'pdf' &&
    bytes.subarray(0, 5).toString() === '%PDF-' &&
    bytes.subarray(-1024).includes(Buffer.from('%%EOF'))
  )
    return 'document';
  if (
    mime === 'image/png' &&
    ext === 'png' &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image';
  if (
    mime === 'image/jpeg' &&
    ['jpg', 'jpeg'].includes(ext ?? '') &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return 'image';
  if (
    mime === 'image/webp' &&
    ext === 'webp' &&
    bytes.subarray(0, 4).toString() === 'RIFF' &&
    bytes.subarray(8, 12).toString() === 'WEBP'
  )
    return 'image';
  if (
    ['audio/webm', 'video/webm'].includes(mime) &&
    ext === 'webm' &&
    bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  )
    return 'media';
  if (mime === 'audio/ogg' && ext === 'ogg' && bytes.subarray(0, 4).toString() === 'OggS')
    return 'media';
  if (
    ['audio/mp4', 'video/mp4'].includes(mime) &&
    ['m4a', 'mp4'].includes(ext ?? '') &&
    bytes.subarray(4, 8).toString() === 'ftyp'
  )
    return 'media';
  if (
    mime === 'audio/mpeg' &&
    ext === 'mp3' &&
    (bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 255 && (bytes[1]! & 0xe0) === 0xe0))
  )
    return 'media';
  throw new ServiceError(400, 'INVALID_FILE_TYPE');
}
export async function initializeAssets(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS stored_files(id uuid PRIMARY KEY,owner_id uuid NOT NULL,owner_code varchar(13) NOT NULL,name text NOT NULL,mime text NOT NULL,bytes int NOT NULL,purpose text NOT NULL,access text NOT NULL,authorized_users jsonb NOT NULL DEFAULT '[]',state text NOT NULL,scan_status text NOT NULL DEFAULT 'PENDING',revision int NOT NULL DEFAULT 0,attempts int NOT NULL DEFAULT 0,next_scan_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz);
  CREATE TABLE IF NOT EXISTS file_references(file_id uuid REFERENCES stored_files(id),reference text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(file_id,reference));
  CREATE TABLE IF NOT EXISTS file_audit(id bigserial PRIMARY KEY,actor_id uuid,file_id uuid,action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS file_limits(purpose text PRIMARY KEY,max_bytes int NOT NULL);
  INSERT INTO file_limits VALUES('avatar',5242880),('image',10485760),('document',20971520),('communication',20971520),('channel',20971520) ON CONFLICT DO NOTHING;`);
}
type Asset = {
  id: string;
  owner_id: string;
  owner_code: string;
  name: string;
  mime: string;
  bytes: number;
  purpose: string;
  access: string;
  authorized_users: string[];
  state: string;
  scan_status: string;
  revision: number;
};
async function checkAccess(req: Request, file: Asset) {
  const user = await principal(req);
  if (
    file.access === 'PUBLIC' ||
    (file.access !== 'ADMIN_ONLY' && file.owner_id === user.id) ||
    (file.access === 'AUTHORIZED_USERS' && file.authorized_users.includes(user.public_id))
  )
    return user;
  if (['communication', 'channel'].includes(file.purpose)) {
    await internalCall(
      'messaging-service',
      file.purpose === 'communication'
        ? '/internal/communications/file-access'
        : '/internal/channels/file-access',
      req.get('authorization') ?? '',
      { id: file.id },
    );
    return user;
  }
  // Reviewers have a separate document permission; other files require file administration.
  try {
    await requirePermission(req, 'file.admin');
  } catch (error) {
    if (!(error instanceof ServiceError) || error.status !== 403 || file.purpose !== 'document')
      throw error;
    await internalCall(
      'scholar-service',
      '/internal/files/review-access',
      req.get('authorization') ?? '',
      { id: file.id },
    );
  }
  return user;
}
export function assetsRouter(pool: Pool) {
  const router = internalRouter('28mb');
  router.post(
    '/internal/files/release-document',
    endpoint(async (req, res) => {
      const user = await principal(req);
      const input = z
        .object({ id: z.string().uuid(), document_id: z.string().uuid() })
        .strict()
        .parse(req.body);
      await internalCall(
        'scholar-service',
        '/internal/files/released-document',
        req.get('authorization') ?? '',
        input,
      );
      await pool.query(
        'DELETE FROM file_references r USING stored_files f WHERE r.file_id=f.id AND f.owner_id=$1 AND r.file_id=$2 AND r.reference=$3',
        [user.id, input.id, 'scholar-document:' + input.document_id],
      );
      res.json({ data: { ok: true } });
    }),
  );
  for (const kind of ['communication', 'channel'] as const)
    router.post(
      '/internal/files/' + kind + '-claim',
      endpoint(async (req, res) => {
        const u = await principal(req),
          d = z
            .object({
              id: z.string().uuid(),
              conversation_id: z.string().uuid().optional(),
              channel_id: z.string().uuid().optional(),
              type: z.enum(['TEXT', 'IMAGE', 'FILE', 'VOICE', 'VIDEO']).optional(),
            })
            .strict()
            .parse(req.body);
        const context = kind === 'communication' ? d.conversation_id : d.channel_id;
        if (!context) throw new ServiceError(400, 'CONTEXT_REQUIRED');
        await internalCall(
          'messaging-service',
          kind === 'communication'
            ? '/internal/communications/authorize'
            : '/internal/channels/file-owner',
          req.get('authorization') ?? '',
          kind === 'communication'
            ? { conversation_id: context, write: true }
            : { channel_id: context },
        );
        await transaction(pool, async (db) => {
          const f = (await db.query('SELECT * FROM stored_files WHERE id=$1 FOR UPDATE', [d.id]))
            .rows[0];
          if (
            !f ||
            f.owner_id !== u.id ||
            f.state !== 'READY' ||
            f.purpose !== kind ||
            f.access !== 'OWNER_ONLY'
          )
            throw new ServiceError(409, 'FILE_NOT_READY');
          if (
            (d.type === 'VOICE' && !f.mime.startsWith('audio/')) ||
            (d.type === 'VIDEO' && !f.mime.startsWith('video/')) ||
            (d.type === 'IMAGE' && !f.mime.startsWith('image/'))
          )
            throw new ServiceError(400, 'INVALID_FILE_TYPE');
          await db.query(
            'INSERT INTO file_references(file_id,reference) VALUES($1,$2) ON CONFLICT DO NOTHING',
            [d.id, kind + ':' + context],
          );
        });
        res.json({ data: { ok: true } });
      }),
    );
  const load = async (id: string): Promise<Asset> => {
    const row = (await pool.query('SELECT * FROM stored_files WHERE id=$1', [id])).rows[0];
    if (!row) throw new ServiceError(404, 'NOT_FOUND');
    return row;
  };
  router.get(
    '/api/v2/files/limits',
    endpoint(async (req, res) => {
      await principal(req);
      res.json({ data: (await pool.query('SELECT * FROM file_limits ORDER BY purpose')).rows });
    }),
  );
  router.put(
    '/api/v2/files/limits',
    endpoint(async (req, res) => {
      const user = await requirePermission(req, 'file.admin');
      const input = z
        .object({
          purpose: z.enum(['avatar', 'image', 'document', 'communication', 'channel']),
          max_bytes: z
            .number()
            .int()
            .min(1024)
            .max(20 * 1024 * 1024),
        })
        .strict()
        .parse(req.body);
      await transaction(pool, async (db) => {
        await db.query('UPDATE file_limits SET max_bytes=$2 WHERE purpose=$1', [
          input.purpose,
          input.max_bytes,
        ]);
        await db.query("INSERT INTO file_audit(actor_id,action) VALUES($1,'LIMIT_UPDATED')", [
          user.id,
        ]);
      });
      res.json({ data: input });
    }),
  );
  router.post(
    '/api/v2/files/assets',
    endpoint(async (req, res) => {
      const user = await principal(req);
      const input = z
        .object({
          name: z
            .string()
            .min(1)
            .max(150)
            .refine((v) => ![...v].some((c) => c.charCodeAt(0) < 32 || c === '/' || c === '\\')),
          mime: z.enum([
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/webp',
            'audio/webm',
            'video/webm',
            'audio/ogg',
            'audio/mp4',
            'video/mp4',
            'audio/mpeg',
          ]),
          purpose: z.enum(['avatar', 'image', 'document', 'communication', 'channel']),
          access: z.enum(['OWNER_ONLY', 'ADMIN_ONLY', 'AUTHORIZED_USERS', 'PUBLIC']),
          authorized_users: z
            .array(z.string().regex(/^[A-Za-z0-9]{13}$/))
            .max(50)
            .default([]),
          base64: z
            .string()
            .min(4)
            .max(maxTransport)
            .regex(/^[A-Za-z0-9+/]+={0,2}$/),
        })
        .strict()
        .parse(req.body);
      const bytes = Buffer.from(input.base64, 'base64');
      if (bytes.toString('base64') !== input.base64) throw new ServiceError(400, 'INVALID_INPUT');
      const limit = (
        await pool.query('SELECT max_bytes FROM file_limits WHERE purpose=$1', [input.purpose])
      ).rows[0].max_bytes;
      if (!bytes.length || bytes.length > limit) throw new ServiceError(413, 'FILE_TOO_LARGE');
      const detected = validateSignature(bytes, input.name, input.mime);
      if (['avatar', 'image'].includes(input.purpose) && detected !== 'image')
        throw new ServiceError(400, 'INVALID_FILE_TYPE');
      if (input.purpose === 'document' && input.access === 'PUBLIC')
        throw new ServiceError(400, 'PRIVATE_DOCUMENT_REQUIRED');
      if (
        ['communication', 'channel'].includes(input.purpose) &&
        (input.access !== 'OWNER_ONLY' || input.authorized_users.length)
      )
        throw new ServiceError(400, 'PRIVATE_FILE_REQUIRED');
      if (input.purpose === 'document' && detected === 'media')
        throw new ServiceError(400, 'INVALID_FILE_TYPE');
      const id = randomUUID();
      await transaction(pool, async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [user.id]);
        if (
          (
            await db.query(
              'SELECT 1 FROM stored_files WHERE owner_id=$1 AND deleted_at IS NULL OFFSET 199 LIMIT 1',
              [user.id],
            )
          ).rowCount
        )
          throw new ServiceError(429, 'FILE_LIMIT');
        await db.query(
          "INSERT INTO stored_files(id,owner_id,owner_code,name,mime,bytes,purpose,access,authorized_users,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'UPLOADING')",
          [
            id,
            user.id,
            user.public_id,
            input.name,
            input.mime,
            bytes.length,
            input.purpose,
            input.access,
            JSON.stringify(input.authorized_users),
          ],
        );
      });
      try {
        await putObject('quarantine/' + id, bytes, input.mime);
        await pool.query("UPDATE stored_files SET state='SCANNING' WHERE id=$1", [id]);
      } catch {
        await pool.query("UPDATE stored_files SET state='REJECTED' WHERE id=$1", [id]);
        throw new ServiceError(503, 'STORAGE_UNAVAILABLE');
      }
      res.status(201).json({ data: { id, state: 'SCANNING' } });
    }),
  );
  router.get(
    '/api/v2/files/assets',
    endpoint(async (req, res) => {
      const user = await principal(req),
        admin = req.query.admin === '1';
      if (admin) await requirePermission(req, 'file.admin');
      const offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(100000)
        .parse(req.query.offset ?? 0);
      res.json({
        data: (
          await pool.query(
            "SELECT f.id,f.owner_code,f.name,f.mime,f.bytes,f.purpose,f.access,f.state,f.scan_status,f.created_at,f.revision,(SELECT count(*)::int FROM file_references WHERE file_id=f.id) AS references FROM stored_files f WHERE ($1 AND f.purpose NOT IN ('communication','channel')) OR owner_id=$2 ORDER BY created_at DESC LIMIT 50 OFFSET $3",
            [admin, user.id, offset],
          )
        ).rows,
      });
    }),
  );
  router.get(
    '/api/v2/files/assets/:id',
    endpoint(async (req, res) => {
      const file = await load(z.string().uuid().parse(req.params.id));
      await checkAccess(req, file);
      res.json({
        data: {
          id: file.id,
          state: file.state,
          scan_status: file.scan_status,
          name: file.name,
          mime: file.mime,
          bytes: file.bytes,
        },
      });
    }),
  );
  router.post(
    '/api/v2/files/assets/:id/link',
    endpoint(async (req, res) => {
      const file = await load(z.string().uuid().parse(req.params.id));
      const user = await checkAccess(req, file);
      if (file.state !== 'READY') throw new ServiceError(409, 'FILE_NOT_READY');
      const payload = Buffer.from(
        JSON.stringify({
          id: file.id,
          user: user.id,
          revision: file.revision,
          expires: Date.now() + 60000,
        }),
      ).toString('base64url');
      const signature = createHmac('sha256', process.env.AUTH_INTERNAL_KEY!)
        .update(payload)
        .digest('base64url');
      await pool.query(
        "INSERT INTO file_audit(actor_id,file_id,action) VALUES($1,$2,'PRIVATE_LINK_ISSUED')",
        [user.id, file.id],
      );
      res.json({
        data: {
          path: 'files/assets/' + file.id + '/download?token=' + payload + '.' + signature,
          expires_in: 60,
        },
      });
    }),
  );
  router.get(
    '/api/v2/files/assets/:id/download',
    endpoint(async (req, res) => {
      const file = await load(z.string().uuid().parse(req.params.id));
      const user = await checkAccess(req, file);
      const token = z.string().max(1000).parse(req.query.token),
        [payload, signature] = token.split('.');
      if (!payload || !signature) throw new ServiceError(403, 'INVALID_LINK');
      const expected = createHmac('sha256', process.env.AUTH_INTERNAL_KEY!)
          .update(payload)
          .digest(),
        provided = Buffer.from(signature, 'base64url');
      if (provided.length !== expected.length || !timingSafeEqual(expected, provided))
        throw new ServiceError(403, 'INVALID_LINK');
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (
        data.id !== file.id ||
        data.user !== user.id ||
        data.revision !== file.revision ||
        data.expires < Date.now() ||
        file.state !== 'READY'
      )
        throw new ServiceError(403, 'INVALID_LINK');
      const bytes = await getObject('ready/' + file.id);
      await pool.query(
        "INSERT INTO file_audit(actor_id,file_id,action) VALUES($1,$2,'PRIVATE_DOWNLOAD')",
        [user.id, file.id],
      );
      res.json({ data: { name: file.name, mime: file.mime, base64: bytes.toString('base64') } });
    }),
  );
  router.get(
    '/api/v2/files/public/:id',
    endpoint(async (req, res) => {
      const file = await load(z.string().uuid().parse(req.params.id));
      if (file.state !== 'READY' || file.access !== 'PUBLIC' || file.purpose === 'document')
        throw new ServiceError(404, 'NOT_FOUND');
      res.json({
        data: { mime: file.mime, base64: (await getObject('ready/' + file.id)).toString('base64') },
      });
    }),
  );
  router.post(
    '/api/v2/files/assets/:id/action',
    endpoint(async (req, res) => {
      const user = await principal(req);
      const id = z.string().uuid().parse(req.params.id);
      const input = z
        .object({ action: z.enum(['BLOCK', 'DELETE', 'QUARANTINE', 'RESCAN']) })
        .strict()
        .parse(req.body);
      if (input.action !== 'DELETE') await requirePermission(req, 'file.admin');
      await transaction(pool, async (db) => {
        const file = (await db.query('SELECT * FROM stored_files WHERE id=$1 FOR UPDATE', [id]))
          .rows[0];
        if (!file) throw new ServiceError(404, 'NOT_FOUND');
        if (file.owner_id !== user.id) await requirePermission(req, 'file.admin');
        if (
          input.action === 'DELETE' &&
          (await db.query('SELECT 1 FROM file_references WHERE file_id=$1 LIMIT 1', [id])).rowCount
        )
          throw new ServiceError(409, 'FILE_IN_USE');
        if (file.state === 'DELETED') throw new ServiceError(409, 'INVALID_TRANSITION');
        const state = {
          BLOCK: 'REJECTED',
          DELETE: 'DELETED',
          QUARANTINE: 'PROCESSING',
          RESCAN: 'SCANNING',
        }[input.action];
        await db.query(
          "UPDATE stored_files SET state=$2,revision=revision+1,next_scan_at=now(),lease_until=NULL,deleted_at=CASE WHEN $2='DELETED' THEN now() ELSE NULL END WHERE id=$1",
          [id, state],
        );
        await db.query('INSERT INTO file_audit(actor_id,file_id,action) VALUES($1,$2,$3)', [
          user.id,
          id,
          input.action,
        ]);
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.post(
    '/internal/files/validate',
    endpoint(async (req, res) => {
      const input = z
        .object({
          id: z.string().uuid(),
          kind: z.enum(['image', 'document']),
          owner: z.string().regex(/^[A-Za-z0-9]{13}$/),
        })
        .strict()
        .parse(req.body);
      const file = await load(input.id);
      await checkAccess(req, file);
      if (
        file.owner_code !== input.owner ||
        file.state !== 'READY' ||
        (input.kind === 'document'
          ? file.purpose !== 'document'
          : file.purpose === 'document' || file.access !== 'PUBLIC')
      )
        throw new ServiceError(409, 'FILE_NOT_READY');
      res.json({ data: { ok: true } });
    }),
  );
  router.post(
    '/internal/files/reference',
    endpoint(async (req, res) => {
      const input = z
        .object({
          id: z.string().uuid(),
          owner: z.string().regex(/^[A-Za-z0-9]{13}$/),
          reference: z
            .string()
            .regex(/^(scholar-(document|image|service)|taxonomy-image):[a-f0-9-]{36}$/),
        })
        .strict()
        .parse(req.body);
      const user = await principal(req);
      if (user.public_id !== input.owner) throw new ServiceError(403, 'FORBIDDEN');
      await transaction(pool, async (db) => {
        const file = (
          await db.query('SELECT * FROM stored_files WHERE id=$1 FOR UPDATE', [input.id])
        ).rows[0];
        if (!file || file.owner_id !== user.id || file.state !== 'READY')
          throw new ServiceError(409, 'FILE_NOT_READY');
        await db.query(
          'INSERT INTO file_references(file_id,reference) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [input.id, input.reference],
        );
      });
      res.json({ data: { ok: true } });
    }),
  );
  return router;
}
export async function scanOnce(pool: Pool) {
  const claimed = await pool.query(
    `UPDATE stored_files SET lease_until=now()+interval '2 minutes',attempts=attempts+1 WHERE id=(SELECT id FROM stored_files WHERE state='SCANNING' AND next_scan_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
  );
  const file = claimed.rows[0] as Asset | undefined;
  if (!file) return false;
  try {
    const bytes = await getObject('quarantine/' + file.id),
      result = await scan(bytes);
    if (result === 'INFECTED') {
      await transaction(pool, async (db) => {
        await db.query(
          "UPDATE stored_files SET state='INFECTED',scan_status='INFECTED',revision=revision+1,lease_until=NULL WHERE id=$1 AND revision=$2 AND state='SCANNING'",
          [file.id, file.revision],
        );
        await db.query("INSERT INTO file_audit(file_id,action) VALUES($1,'MALWARE_DETECTED')", [
          file.id,
        ]);
      });
      return true;
    }
    let normalized = bytes,
      mime = file.mime;
    if (file.mime.startsWith('image/')) {
      try {
        const source = sharp(bytes, { limitInputPixels: 16777216, failOn: 'warning' });
        const meta = await source.metadata();
        if ((meta.pages ?? 1) > 1) throw new ServiceError(400, 'INVALID_IMAGE');
        normalized = await source
          .rotate()
          .resize(file.purpose === 'avatar' ? 512 : 2048, file.purpose === 'avatar' ? 512 : 2048, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: 85 })
          .toBuffer();
        mime = 'image/webp';
      } catch {
        throw new ServiceError(400, 'INVALID_IMAGE');
      }
    }
    await putObject('ready/' + file.id, normalized, mime);
    await pool.query(
      "UPDATE stored_files SET state='READY',scan_status='CLEAN',mime=$3,bytes=$4,lease_until=NULL WHERE id=$1 AND revision=$2 AND state='SCANNING'",
      [file.id, file.revision, mime, normalized.length],
    );
  } catch (error) {
    const invalid = error instanceof ServiceError && error.status === 400;
    await pool.query(
      "UPDATE stored_files SET state=CASE WHEN $3 THEN 'REJECTED' ELSE state END,lease_until=NULL,next_scan_at=now()+interval '60 seconds' WHERE id=$1 AND revision=$2 AND state='SCANNING'",
      [file.id, file.revision, invalid],
    );
  }
  return true;
}
export function scanWorker(pool: Pool) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<unknown> = Promise.resolve();
  const tick = () => {
    running = scanOnce(pool)
      .catch(() => {})
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, 1000);
      });
  };
  tick();
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await running;
  };
}
