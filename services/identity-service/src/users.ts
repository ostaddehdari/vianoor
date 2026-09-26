import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  internalRouter,
  endpoint,
  requirePermission,
  internalCall,
  ServiceError,
  transaction,
} from '@vianoor/service-runtime';
import type { Identity } from './identity.js';
import { publicId } from './public-id.js';
import { passwordHash, token } from './security.js';
const code = z.string().regex(/^[A-Za-z0-9]{13}$/);
export function usersRouter(identity: Identity) {
  const router = internalRouter();
  router.get(
    '/internal/principal',
    endpoint(async (req, res) => {
      try {
        const user = await identity.session(
          (req.get('authorization') ?? '').replace(/^Bearer /, ''),
        );
        res.json({ data: { id: user.account_id, public_id: user.public_id, email: user.email } });
      } catch {
        throw new ServiceError(401, 'UNAUTHORIZED');
      }
    }),
  );
  router.get(
    '/internal/accounts/:code',
    endpoint(async (req, res) => {
      const id = code.parse(req.params.code);
      const result = await identity.pool.query(
        'SELECT id,public_id,verified_at,disabled_at FROM identity_accounts WHERE public_id=$1',
        [id],
      );
      if (!result.rowCount) throw new ServiceError(404, 'NOT_FOUND');
      res.json({ data: result.rows[0] });
    }),
  );
  router.post(
    '/api/v2/users/search',
    endpoint(async (req, res) => {
      await requirePermission(req, 'users.manage');
      const data = z
        .object({
          query: z.string().max(254).default(''),
          page: z.number().int().min(0).max(10000).default(0),
        })
        .strict()
        .parse(req.body);
      const results = await identity.pool.query(
        `SELECT public_id,email,verified_at,disabled_at,created_at,
      count(*) OVER()::int AS total FROM identity_accounts
      WHERE position(lower($1) in lower(email))>0 OR position(lower($1) in lower(public_id))>0
      ORDER BY created_at DESC LIMIT 25 OFFSET $2`,
        [data.query, data.page * 25],
      );
      res.json({ data: { users: results.rows, total: results.rows[0]?.total ?? 0 } });
    }),
  );
  router.post(
    '/api/v2/users',
    endpoint(async (req, res) => {
      const actor = await requirePermission(req, 'users.manage');
      const data = z
        .object({
          email: z.string().trim().toLowerCase().email().max(254),
          locale: z.enum(['fa', 'en']).default('fa'),
        })
        .strict()
        .parse(req.body);
      const hash = await passwordHash(token());
      const result = await transaction(identity.pool, async (db) => {
        const created = await db.query(
          `INSERT INTO identity_accounts(id,public_id,email,password_hash)
        VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING id,public_id,email`,
          [randomUUID(), publicId(), data.email, hash],
        );
        if (!created.rowCount) throw new ServiceError(409, 'ACCOUNT_EXISTS');
        await identity.issueMail(db, created.rows[0], 'reset', data.locale);
        await db.query(
          'INSERT INTO identity_admin_audit(actor_id,target_id,action) VALUES($1,$2,$3)',
          [actor.id, created.rows[0].id, 'invited'],
        );
        return { public_id: created.rows[0].public_id };
      });
      res.status(201).json({ data: result });
    }),
  );
  router.post(
    '/api/v2/users/:code/invite',
    endpoint(async (req, res) => {
      const actor = await requirePermission(req, 'users.manage');
      const id = code.parse(req.params.code);
      const data = z
        .object({ locale: z.enum(['fa', 'en']).default('fa') })
        .strict()
        .parse(req.body);
      await transaction(identity.pool, async (db) => {
        const account = (
          await db.query(
            'SELECT id,email FROM identity_accounts WHERE public_id=$1 AND disabled_at IS NULL FOR UPDATE',
            [id],
          )
        ).rows[0];
        if (!account) throw new ServiceError(404, 'NOT_FOUND');
        await identity.issueMail(db, account, 'reset', data.locale);
        await db.query(
          'INSERT INTO identity_admin_audit(actor_id,target_id,action) VALUES($1,$2,$3)',
          [actor.id, account.id, 'invitation_resent'],
        );
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.patch(
    '/api/v2/users/:code',
    endpoint(async (req, res) => {
      const actor = await requirePermission(req, 'users.manage');
      const id = code.parse(req.params.code);
      const data = z.object({ disabled: z.boolean() }).strict().parse(req.body);
      if (data.disabled)
        await internalCall(
          'organization-service',
          '/internal/can-disable',
          req.get('authorization') ?? '',
          { public_id: id },
        );
      await transaction(identity.pool, async (db) => {
        const account = (
          await db.query(
            'UPDATE identity_accounts SET disabled_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE public_id=$1 RETURNING id',
            [id, data.disabled],
          )
        ).rows[0];
        if (!account) throw new ServiceError(404, 'NOT_FOUND');
        if (data.disabled)
          await db.query(
            'UPDATE identity_sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL',
            [account.id],
          );
        await db.query(
          'INSERT INTO identity_admin_audit(actor_id,target_id,action) VALUES($1,$2,$3)',
          [actor.id, account.id, data.disabled ? 'disabled' : 'enabled'],
        );
      });
      if (!data.disabled)
        await internalCall(
          'organization-service',
          '/internal/finish-enable',
          req.get('authorization') ?? '',
          { public_id: id },
        );
      res.json({ data: { ok: true } });
    }),
  );
  return router;
}
