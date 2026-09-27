import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import type { Pool } from 'pg';
import { putObject, getObject } from './object-store.js';
import { scan } from './scanner.js';
import {
  internalRouter,
  endpoint,
  principal,
  requirePermission,
  internalCall,
  ServiceError,
  transaction,
} from '@vianoor/service-runtime';
const storage = process.env.FILE_STORAGE_PATH ?? '/var/lib/vianoor/avatars';
const objectStorageEnabled = () => process.env.SCHOLARS_ENABLED === '1';
async function storeLegacyImage(
  pool: Pool,
  image: { id: string; account_id: string; public_id: string; kind: string },
  bytes: Buffer,
) {
  if ((await scan(bytes)) !== 'CLEAN') throw new ServiceError(400, 'INVALID_IMAGE');
  await putObject('quarantine/' + image.id, bytes, 'image/webp');
  await putObject('ready/' + image.id, bytes, 'image/webp');
  await transaction(pool, async (db) => {
    await db.query(
      "INSERT INTO stored_files(id,owner_id,owner_code,name,mime,bytes,purpose,access,state,scan_status) VALUES($1,$2,$3,$4,'image/webp',$5,$6,'OWNER_ONLY','READY','CLEAN') ON CONFLICT DO NOTHING",
      [
        image.id,
        image.account_id,
        image.public_id,
        image.id + '.webp',
        bytes.length,
        image.kind === 'avatar' ? 'avatar' : 'image',
      ],
    );
    await db.query(
      'INSERT INTO file_references(file_id,reference) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [image.id, 'legacy-image:' + image.id],
    );
  });
}
export async function normalizeImage(bytes: Buffer) {
  if (bytes.length > 2 * 1024 * 1024 || !bytes.length) throw new ServiceError(400, 'INVALID_IMAGE');
  try {
    const source = sharp(bytes, { limitInputPixels: 16777216, failOn: 'warning' });
    const meta = await source.metadata();
    if (!['jpeg', 'png', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1)
      throw new Error();
    return await source
      .rotate()
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    throw new ServiceError(400, 'INVALID_IMAGE');
  }
}
export async function initializeFiles(pool: Pool) {
  await mkdir(storage, { recursive: true, mode: 0o700 });
  await pool.query(`CREATE TABLE IF NOT EXISTS user_images (id uuid PRIMARY KEY, account_id uuid NOT NULL,
    public_id varchar(13) NOT NULL, kind text NOT NULL CHECK(kind IN ('avatar','attachment')), bytes int NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now());`);
}
export function filesRouter(pool: Pool) {
  const router = internalRouter('3mb');
  router.post(
    '/api/v2/files/images',
    endpoint(async (req, res) => {
      const user = await principal(req);
      const data = z
        .object({
          base64: z
            .string()
            .max(2800000)
            .regex(/^[A-Za-z0-9+/]+={0,2}$/),
          kind: z.enum(['avatar', 'attachment']),
        })
        .strict()
        .parse(req.body);
      const bytes = await normalizeImage(Buffer.from(data.base64, 'base64'));
      const id = randomUUID();
      await transaction(pool, async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [user.id]);
        const count = (
          await db.query('SELECT count(*)::int AS total FROM user_images WHERE account_id=$1', [
            user.id,
          ])
        ).rows[0].total;
        if (count >= 50) throw new ServiceError(429, 'IMAGE_LIMIT');
        if (objectStorageEnabled())
          await storeLegacyImage(
            pool,
            { id, account_id: user.id, public_id: user.public_id, kind: data.kind },
            bytes,
          );
        if (!objectStorageEnabled())
          await writeFile(join(storage, id + '.webp'), bytes, { flag: 'wx', mode: 0o600 });
        try {
          await db.query(
            'INSERT INTO user_images(id,account_id,public_id,kind,bytes) VALUES($1,$2,$3,$4,$5)',
            [id, user.id, user.public_id, data.kind, bytes.length],
          );
        } catch (e) {
          if (!objectStorageEnabled()) await unlink(join(storage, id + '.webp'));
          throw e;
        }
      });
      res.status(201).json({ data: { id } });
    }),
  );
  router.get(
    '/api/v2/files/images/:id',
    endpoint(async (req, res) => {
      const user = await principal(req);
      const id = z.string().uuid().parse(req.params.id);
      const image = (await pool.query('SELECT * FROM user_images WHERE id=$1', [id])).rows[0];
      if (!image) throw new ServiceError(404, 'NOT_FOUND');
      if (image.kind !== 'avatar' && image.account_id !== user.id) {
        try {
          await requirePermission(req, 'users.manage');
        } catch (error) {
          if (!(error instanceof ServiceError) || error.status !== 403) throw error;
          await internalCall(
            'profile-service',
            '/internal/image-visible',
            req.get('authorization') ?? '',
            { public_id: image.public_id, id },
          );
        }
      }
      if (image.kind === 'avatar' && image.account_id !== user.id) {
        const sharing = await internalCall<{ accepted: boolean }>(
          'consent-service',
          '/internal/profile-sharing/' + image.public_id,
        );
        if (!sharing.accepted) await requirePermission(req, 'users.manage');
      }
      let bytes: Buffer;
      if (objectStorageEnabled()) {
        let stored = (await pool.query('SELECT state FROM stored_files WHERE id=$1', [id])).rows[0];
        if (!stored) {
          await storeLegacyImage(pool, image, await readFile(join(storage, id + '.webp')));
          stored = { state: 'READY' };
        }
        if (stored.state !== 'READY') throw new ServiceError(409, 'FILE_NOT_READY');
        bytes = await getObject('ready/' + id);
      } else bytes = await readFile(join(storage, id + '.webp'));
      res.json({ data: { id, data_url: 'data:image/webp;base64,' + bytes.toString('base64') } });
    }),
  );
  router.post(
    '/internal/owned-image',
    endpoint(async (req, res) => {
      const user = await principal(req);
      const data = z
        .object({
          id: z.string().uuid(),
          public_id: z.string().regex(/^[A-Za-z0-9]{13}$/),
          avatar: z.boolean(),
        })
        .strict()
        .parse(req.body);
      if (data.public_id !== user.public_id) await requirePermission(req, 'users.manage');
      const image = (
        await pool.query('SELECT 1 FROM user_images WHERE id=$1 AND public_id=$2 AND kind=$3', [
          data.id,
          data.public_id,
          data.avatar ? 'avatar' : 'attachment',
        ])
      ).rowCount;
      if (!image) throw new ServiceError(403, 'FORBIDDEN');
      res.json({ data: { ok: true } });
    }),
  );
  return router;
}
