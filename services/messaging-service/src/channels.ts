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
import { uuid, seal, open } from './model.js';
const auth = (req: { get(name: string): string | undefined }) => req.get('authorization') ?? '';
export function channelRouter(pool: Pool) {
  const r = internalRouter();
  r.get(
    '/api/v2/channels/public/:slug',
    endpoint(async (req, res) => {
      const slug = z
        .string()
        .regex(/^[a-z0-9-]{3,80}$/)
        .parse(req.params.slug);
      const c = (
        await pool.query(
          'SELECT id,slug,title,description FROM expert_channels WHERE slug=$1 AND active',
          [slug],
        )
      ).rows[0];
      if (!c) throw new ServiceError(404, 'CHANNEL_NOT_FOUND');
      res.json({
        data: {
          ...c,
          posts: (
            await pool.query(
              'SELECT id,body,created_at,jsonb_array_length(files) AS attachment_count FROM channel_posts WHERE channel_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50',
              [c.id],
            )
          ).rows,
        },
      });
    }),
  );
  r.get(
    '/api/v2/channels',
    endpoint(async (req, res) => {
      const d = z
        .object({
          expert: z
            .string()
            .regex(/^[A-Za-z0-9]{13}$/)
            .optional(),
        })
        .strict()
        .parse(req.query);
      res.json({
        data: (
          await pool.query(
            'SELECT id,expert_code,slug,title,description,comments_enabled FROM expert_channels WHERE active AND ($1::text IS NULL OR expert_code=$1) ORDER BY title LIMIT 100',
            [d.expert ?? null],
          )
        ).rows,
      });
    }),
  );
  r.post(
    '/api/v2/channels',
    endpoint(async (req, res) => {
      const u = await requirePermission(req, 'booking.attend'),
        d = z
          .object({
            title: z.string().trim().min(2).max(120),
            description: z.string().max(2000).default(''),
            comments_enabled: z.boolean().default(true),
          })
          .strict()
          .parse(req.body);
      const expert = await internalCall<{ status: string; slug: string }>(
        'scholar-service',
        '/api/v2/experts/me',
        auth(req),
      );
      if (expert.status !== 'APPROVED') throw new ServiceError(403, 'EXPERT_UNAVAILABLE');
      const result = (
        await pool.query(
          'INSERT INTO expert_channels(id,expert_id,expert_code,slug,title,description,comments_enabled) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(expert_id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,comments_enabled=EXCLUDED.comments_enabled RETURNING id,expert_code,slug,title,description,comments_enabled',
          [
            randomUUID(),
            u.id,
            u.public_id,
            expert.slug,
            d.title,
            d.description,
            d.comments_enabled,
          ],
        )
      ).rows[0];
      res.json({ data: result });
    }),
  );
  r.get(
    '/api/v2/channels/:id',
    endpoint(async (req, res) => {
      const id = uuid.parse(req.params.id),
        u = await principal(req),
        c = (
          await pool.query(
            'SELECT id,expert_id,expert_code,slug,title,description,comments_enabled FROM expert_channels WHERE id=$1 AND active',
            [id],
          )
        ).rows[0];
      if (!c) throw new ServiceError(404, 'CHANNEL_NOT_FOUND');
      const followed = !!(
        await pool.query('SELECT 1 FROM channel_followers WHERE channel_id=$1 AND account_id=$2', [
          id,
          u.id,
        ])
      ).rowCount;
      res.json({
        data: {
          ...c,
          owner: c.expert_id === u.id,
          following: followed,
          posts: (
            await pool.query(
              'SELECT id,body,files,created_at FROM channel_posts WHERE channel_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50',
              [id],
            )
          ).rows,
        },
      });
    }),
  );
  r.post(
    '/api/v2/channels/:id/follow',
    endpoint(async (req, res) => {
      const u = await principal(req),
        id = uuid.parse(req.params.id),
        d = z.object({ follow: z.boolean() }).strict().parse(req.body);
      if (
        !(await pool.query('SELECT 1 FROM expert_channels WHERE id=$1 AND active', [id])).rowCount
      )
        throw new ServiceError(404, 'CHANNEL_NOT_FOUND');
      if (d.follow)
        await pool.query(
          'INSERT INTO channel_followers(channel_id,account_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [id, u.id],
        );
      else
        await pool.query('DELETE FROM channel_followers WHERE channel_id=$1 AND account_id=$2', [
          id,
          u.id,
        ]);
      res.json({ data: { following: d.follow } });
    }),
  );
  r.post(
    '/api/v2/channels/:id/posts',
    endpoint(async (req, res) => {
      const u = await requirePermission(req, 'booking.attend'),
        id = uuid.parse(req.params.id),
        d = z
          .object({
            request_key: uuid,
            body: z.string().trim().max(12000),
            files: z.array(uuid).max(8).default([]),
          })
          .strict()
          .parse(req.body);
      if (!d.body && !d.files.length) throw new ServiceError(400, 'EMPTY_POST');
      if (
        !(
          await pool.query(
            'SELECT 1 FROM expert_channels WHERE id=$1 AND expert_id=$2 AND active',
            [id, u.id],
          )
        ).rowCount
      )
        throw new ServiceError(403, 'FORBIDDEN');
      const existing = (
        await pool.query('SELECT * FROM channel_posts WHERE channel_id=$1 AND request_key=$2', [
          id,
          d.request_key,
        ])
      ).rows[0];
      if (existing) {
        if (existing.body !== d.body || JSON.stringify(existing.files) !== JSON.stringify(d.files))
          throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT');
        res.json({ data: existing });
        return;
      }
      const postId = randomUUID();
      for (const file of d.files)
        await internalCall('file-service', '/internal/files/channel-claim', auth(req), {
          id: file,
          channel_id: id,
        });
      const post = await transaction(pool, async (db) => {
        await db.query('SELECT id FROM expert_channels WHERE id=$1 FOR UPDATE', [id]);
        const previous = (
          await db.query('SELECT * FROM channel_posts WHERE channel_id=$1 AND request_key=$2', [
            id,
            d.request_key,
          ])
        ).rows[0];
        if (previous) {
          if (
            previous.body !== d.body ||
            JSON.stringify(previous.files) !== JSON.stringify(d.files)
          )
            throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT');
          return previous;
        }
        const p = (
          await db.query(
            'INSERT INTO channel_posts(id,channel_id,author_id,body,files,request_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
            [postId, id, u.id, d.body, JSON.stringify(d.files), d.request_key],
          )
        ).rows[0];
        await db.query(
          "INSERT INTO communication_notifications(id,account_id,conversation_id,event) SELECT gen_random_uuid(),account_id,$1,'CHANNEL_POST' FROM channel_followers WHERE channel_id=$1 AND account_id<>$2",
          [id, u.id],
        );
        return p;
      });
      res.json({ data: post });
    }),
  );
  r.post(
    '/api/v2/channels/posts/:id/remove',
    endpoint(async (req, res) => {
      const u = await principal(req),
        id = uuid.parse(req.params.id);
      const result = await pool.query(
        'UPDATE channel_posts p SET deleted_at=now() FROM expert_channels c WHERE p.id=$1 AND p.channel_id=c.id AND c.expert_id=$2 RETURNING p.id',
        [id, u.id],
      );
      if (!result.rowCount) throw new ServiceError(404, 'NOT_FOUND');
      res.json({ data: { ok: true } });
    }),
  );
  r.get(
    '/api/v2/channels/posts/:id/comments',
    endpoint(async (req, res) => {
      const u = await principal(req),
        id = uuid.parse(req.params.id);
      const rows = (
        await pool.query(
          "SELECT x.* FROM channel_comments x JOIN channel_posts p ON p.id=x.post_id JOIN expert_channels c ON c.id=p.channel_id WHERE p.id=$1 AND p.deleted_at IS NULL AND c.active AND (x.state='APPROVED' OR x.author_id=$2 OR c.expert_id=$2) ORDER BY x.created_at LIMIT 100",
          [id, u.id],
        )
      ).rows;
      res.json({
        data: rows.map((x) => ({
          id: x.id,
          author_id: x.author_id,
          state: x.state,
          body: open(x.sealed_body, x.id),
          created_at: x.created_at,
        })),
      });
    }),
  );
  r.post(
    '/api/v2/channels/posts/:id/comments',
    endpoint(async (req, res) => {
      const u = await principal(req),
        id = uuid.parse(req.params.id),
        d = z
          .object({ request_key: uuid, body: z.string().trim().min(1).max(3000) })
          .strict()
          .parse(req.body);
      if (
        !(
          await pool.query(
            'SELECT 1 FROM channel_posts p JOIN expert_channels c ON c.id=p.channel_id WHERE p.id=$1 AND p.deleted_at IS NULL AND c.active AND c.comments_enabled',
            [id],
          )
        ).rowCount
      )
        throw new ServiceError(403, 'COMMENTS_CLOSED');
      const count = (
        await pool.query(
          "SELECT count(*)::int AS n FROM channel_comments WHERE author_id=$1 AND created_at>now()-interval '1 hour'",
          [u.id],
        )
      ).rows[0].n;
      if (count >= 30) throw new ServiceError(429, 'MESSAGE_RATE_LIMIT');
      const commentId = randomUUID(),
        row = (
          await pool.query(
            'INSERT INTO channel_comments(id,post_id,author_id,sealed_body,request_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(post_id,author_id,request_key) DO UPDATE SET request_key=EXCLUDED.request_key RETURNING *',
            [commentId, id, u.id, seal(d.body, commentId), d.request_key],
          )
        ).rows[0];
      if (open(row.sealed_body, row.id) !== d.body)
        throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT');
      res.json({ data: { id: row.id, state: row.state } });
    }),
  );
  r.post(
    '/api/v2/channels/comments/:id/review',
    endpoint(async (req, res) => {
      const u = await principal(req),
        id = uuid.parse(req.params.id),
        d = z
          .object({ state: z.enum(['APPROVED', 'REJECTED']) })
          .strict()
          .parse(req.body);
      if (
        !(
          await pool.query(
            'SELECT 1 FROM channel_comments x JOIN channel_posts p ON p.id=x.post_id JOIN expert_channels c ON c.id=p.channel_id WHERE x.id=$1 AND c.expert_id=$2',
            [id, u.id],
          )
        ).rowCount
      )
        await requirePermission(req, 'communication.manage');
      await pool.query('UPDATE channel_comments SET state=$2 WHERE id=$1', [id, d.state]);
      await pool.query('INSERT INTO communication_audit(actor_id,action) VALUES($1,$2)', [
        u.id,
        'COMMENT_' + d.state,
      ]);
      res.json({ data: { ok: true } });
    }),
  );
  r.post(
    '/internal/channels/file-owner',
    endpoint(async (req, res) => {
      const u = await principal(req),
        d = z.object({ channel_id: uuid }).strict().parse(req.body);
      if (
        !(
          await pool.query(
            'SELECT 1 FROM expert_channels WHERE id=$1 AND expert_id=$2 AND active',
            [d.channel_id, u.id],
          )
        ).rowCount
      )
        throw new ServiceError(403, 'FORBIDDEN');
      res.json({ data: { ok: true } });
    }),
  );
  r.post(
    '/internal/channels/file-access',
    endpoint(async (req, res) => {
      await principal(req);
      const d = z.object({ id: uuid }).strict().parse(req.body);
      if (
        !(
          await pool.query(
            'SELECT 1 FROM channel_posts p JOIN expert_channels c ON c.id=p.channel_id WHERE c.active AND p.deleted_at IS NULL AND p.files @> $1::jsonb LIMIT 1',
            [JSON.stringify([d.id])],
          )
        ).rowCount
      )
        throw new ServiceError(403, 'FORBIDDEN');
      res.json({ data: { ok: true } });
    }),
  );
  return r;
}
