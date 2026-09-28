import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Pool } from 'pg';
import {
  internalRouter,
  endpoint,
  principal,
  internalCall,
  ServiceError,
  transaction,
  type Principal,
} from '@vianoor/service-runtime';

export const roles = {
  account: ['booking.create'],
  expert: ['booking.attend'],
  secretary: ['booking.support'],
  responder: ['question.answer'],
  scientific: [
    'scholar.verify',
    'expert.read',
    'expert.review',
    'expert.approve',
    'expert.suspend',
    'expert.document.review',
    'specialty.manage',
    'service.manage',
  ],
  support: ['ticket.assign', 'communication.manage'],
  finance: ['ledger.read', 'finance.read', 'finance.manage'],
  content: ['content.review'],
  organization: ['membership.manage'],
  admin: [
    'communication.manage',
    'question.manage',
    'notification.manage',
    'finance.read',
    'finance.manage',
    'dispute.manage',
    'calendar.manage',
    'translation.manage',
    'translation.review',
    'search.manage',
    'booking.manage',
    'expert.read',
    'expert.review',
    'expert.approve',
    'expert.suspend',
    'expert.document.review',
    'specialty.manage',
    'service.manage',
    'file.admin',
    'users.manage',
    'permission.grant',
    'forms.manage',
    'organization.manage',
    'membership.manage',
    'audit.read',
  ],
  ai: ['ai.provider.manage'],
  call: ['call.answer'],
  operations: ['service.health.read'],
  auditor: ['audit.read'],
} as const;
const roleSchema = z.enum(Object.keys(roles) as [keyof typeof roles, ...(keyof typeof roles)[]]);
const scopeSchema = z.union([z.literal('platform'), z.string().uuid()]);
const code = z.string().regex(/^[A-Za-z0-9]{13}$/);
const manageable = new Set(['expert', 'secretary', 'responder', 'support']);
export function grantsPermission(
  grants: { role: string; scope: string }[],
  permission: string,
  scope: string,
) {
  return grants.some(
    (g) =>
      (g.scope === 'platform' || g.scope === scope) &&
      (roles[g.role as keyof typeof roles] as readonly string[] | undefined)?.includes(permission),
  );
}
export async function initializeOrganization(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS organizations (
    id uuid PRIMARY KEY, name varchar(120) NOT NULL, parent_id uuid REFERENCES organizations(id), created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS role_grants (
      account_id uuid NOT NULL, public_id varchar(13) NOT NULL, role text NOT NULL, scope text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,role,scope));
    CREATE TABLE IF NOT EXISTS suspended_grants(public_id varchar(13) PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS organization_audit (
      id bigserial PRIMARY KEY, actor_id uuid NOT NULL, target_id text NOT NULL, action text NOT NULL,
      scope text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now());`);
  if (process.env.BOOTSTRAP_ADMIN_CODE) {
    const public_id = code.parse(process.env.BOOTSTRAP_ADMIN_CODE);
    const account = await internalCall<{
      id: string;
      verified_at: string | null;
      disabled_at: string | null;
    }>('identity-service', '/internal/accounts/' + public_id);
    if (!account.verified_at || account.disabled_at)
      throw new Error('Bootstrap requires an active verified account');
    await transaction(pool, async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(20260601)');
      if (
        !(await db.query("SELECT 1 FROM role_grants WHERE role='admin' AND scope='platform'"))
          .rowCount
      ) {
        await db.query(
          "INSERT INTO role_grants(account_id,public_id,role,scope) VALUES($1,$2,'admin','platform')",
          [account.id, public_id],
        );
        await db.query(
          "INSERT INTO organization_audit(actor_id,target_id,action,scope) VALUES($1,$2,'bootstrap_admin','platform')",
          [account.id, public_id],
        );
      }
    });
  }
}
export function organizationRouter(pool: Pool) {
  const router = internalRouter();
  const grants = async (id: string) =>
    (await pool.query('SELECT role,scope FROM role_grants WHERE account_id=$1', [id])).rows;
  const authorize = async (user: Principal, permission: string, scope: string) => {
    if (grantsPermission(await grants(user.id), permission, scope)) return;
    if (
      process.env.SCHOLARS_ENABLED === '1' &&
      permission === 'booking.attend' &&
      scope === 'platform'
    ) {
      const qualification = await internalCall<{ verified: boolean }>(
        'scholar-service',
        '/internal/experts/qualification/' + user.public_id,
      );
      if (qualification.verified) return;
    }
    throw new ServiceError(403, 'FORBIDDEN');
  };
  router.post(
    '/internal/authorize',
    endpoint(async (req, res) => {
      const data = z
        .object({ permission: z.string().max(80), scope: scopeSchema })
        .strict()
        .parse(req.body);
      const user = await principal(req);
      await authorize(user, data.permission, data.scope);
      res.json({ data: user });
    }),
  );
  router.post(
    '/internal/can-disable',
    endpoint(async (req, res) => {
      const user = await principal(req);
      await authorize(user, 'users.manage', 'platform');
      const data = z.object({ public_id: code }).strict().parse(req.body);
      await transaction(pool, async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(20260601)');
        const privileged = await db.query(
          "SELECT 1 FROM role_grants WHERE public_id=$1 AND role='admin'",
          [data.public_id],
        );
        if (privileged.rowCount) throw new ServiceError(409, 'REMOVE_ADMIN_FIRST');
        await db.query(
          'INSERT INTO suspended_grants(public_id) VALUES($1) ON CONFLICT DO NOTHING',
          [data.public_id],
        );
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.get(
    '/internal/experts/:code',
    endpoint(async (req, res) => {
      const public_id = code.parse(req.params.code);
      const result = await pool.query(
        "SELECT 1 FROM role_grants WHERE public_id=$1 AND role='expert' AND scope='platform'",
        [public_id],
      );
      if (!result.rowCount) throw new ServiceError(404, 'NOT_FOUND');
      res.json({ data: { ok: true } });
    }),
  );
  router.post(
    '/internal/finish-enable',
    endpoint(async (req, res) => {
      const user = await principal(req);
      await authorize(user, 'users.manage', 'platform');
      const data = z.object({ public_id: code }).strict().parse(req.body);
      const account = await internalCall<{ disabled_at: string | null }>(
        'identity-service',
        '/internal/accounts/' + data.public_id,
      );
      if (account.disabled_at) throw new ServiceError(409, 'ACCOUNT_DISABLED');
      await pool.query('DELETE FROM suspended_grants WHERE public_id=$1', [data.public_id]);
      res.json({ data: { ok: true } });
    }),
  );
  router.get(
    '/internal/experts',
    endpoint(async (_req, res) => {
      res.json({
        data: (
          await pool.query(
            "SELECT public_id FROM role_grants WHERE role='expert' AND scope='platform' ORDER BY public_id LIMIT 200",
          )
        ).rows,
      });
    }),
  );
  router.get(
    '/api/v2/access/me',
    endpoint(async (req, res) => {
      const user = await principal(req);
      const list = await pool.query(
        `SELECT g.role,g.scope,o.name AS organization_name FROM role_grants g
      LEFT JOIN organizations o ON o.id::text=g.scope WHERE g.account_id=$1 ORDER BY g.created_at`,
        [user.id],
      );
      if (
        process.env.SCHOLARS_ENABLED === '1' &&
        !list.rows.some((r) => r.role === 'expert' && r.scope === 'platform')
      ) {
        const qualification = await internalCall<{ verified: boolean }>(
          'scholar-service',
          '/internal/experts/qualification/' + user.public_id,
        ).catch(() => ({ verified: false }));
        if (qualification.verified)
          list.rows.push({ role: 'expert', scope: 'platform', organization_name: null });
      }
      res.json({
        data: {
          public_id: user.public_id,
          workspaces: [
            { role: 'account', scope: 'platform', organization_name: null },
            ...list.rows,
          ],
        },
      });
    }),
  );
  router.get(
    '/api/v2/access/roles',
    endpoint(async (req, res) => {
      const user = await principal(req);
      await authorize(user, 'permission.grant', 'platform');
      res.json({ data: Object.keys(roles).filter((r) => r !== 'account') });
    }),
  );
  router.get(
    '/api/v2/access/users/:code',
    endpoint(async (req, res) => {
      const user = await principal(req);
      await authorize(user, 'permission.grant', 'platform');
      const public_id = code.parse(req.params.code);
      res.json({
        data: (
          await pool.query('SELECT role,scope FROM role_grants WHERE public_id=$1', [public_id])
        ).rows,
      });
    }),
  );
  router.post(
    '/api/v2/access/grants',
    endpoint(async (req, res) => {
      const user = await principal(req);
      const data = z
        .object({ public_id: code, role: roleSchema, scope: scopeSchema, enabled: z.boolean() })
        .strict()
        .parse(req.body);
      if (data.role === 'account' || (data.role === 'admin' && data.scope !== 'platform'))
        throw new ServiceError(400, 'INVALID_INPUT');
      const own = await grants(user.id);
      if (!grantsPermission(own, 'permission.grant', 'platform')) {
        await authorize(user, 'membership.manage', data.scope);
        if (data.scope === 'platform' || !manageable.has(data.role))
          throw new ServiceError(403, 'FORBIDDEN');
      }
      if (
        data.scope !== 'platform' &&
        !(await pool.query('SELECT 1 FROM organizations WHERE id=$1', [data.scope])).rowCount
      )
        throw new ServiceError(404, 'NOT_FOUND');
      const account = await internalCall<{
        id: string;
        disabled_at: string | null;
        verified_at: string | null;
      }>('identity-service', '/internal/accounts/' + data.public_id);
      if (account.disabled_at && data.enabled) throw new ServiceError(409, 'ACCOUNT_DISABLED');
      if (data.enabled && data.role === 'admin' && !account.verified_at)
        throw new ServiceError(409, 'EMAIL_NOT_VERIFIED');
      await transaction(pool, async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(20260601)');
        if (
          data.enabled &&
          (await db.query('SELECT 1 FROM suspended_grants WHERE public_id=$1', [data.public_id]))
            .rowCount
        )
          throw new ServiceError(409, 'ACCOUNT_DISABLED');
        // Recheck authorization under the same lock used by every role change: no stale grant race.
        const current = (
          await db.query('SELECT role,scope FROM role_grants WHERE account_id=$1', [user.id])
        ).rows;
        if (
          !grantsPermission(current, 'permission.grant', 'platform') &&
          !(
            data.scope !== 'platform' &&
            manageable.has(data.role) &&
            grantsPermission(current, 'membership.manage', data.scope)
          )
        )
          throw new ServiceError(403, 'FORBIDDEN');
        if (!data.enabled && data.role === 'admin') {
          const others = await db.query(
            "SELECT 1 FROM role_grants WHERE role='admin' AND scope='platform' AND account_id<>$1",
            [account.id],
          );
          if (!others.rowCount) throw new ServiceError(409, 'LAST_ADMIN');
        }
        if (data.enabled)
          await db.query(
            'INSERT INTO role_grants(account_id,public_id,role,scope) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
            [account.id, data.public_id, data.role, data.scope],
          );
        else
          await db.query('DELETE FROM role_grants WHERE account_id=$1 AND role=$2 AND scope=$3', [
            account.id,
            data.role,
            data.scope,
          ]);
        await db.query(
          'INSERT INTO organization_audit(actor_id,target_id,action,scope) VALUES($1,$2,$3,$4)',
          [
            user.id,
            data.public_id,
            `${data.enabled ? 'grant' : 'revoke'}:${data.role}`,
            data.scope,
          ],
        );
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.get(
    '/api/v2/access/organizations',
    endpoint(async (req, res) => {
      const user = await principal(req);
      const own = await grants(user.id);
      const all = grantsPermission(own, 'organization.manage', 'platform');
      const rows = await pool.query(
        'SELECT id,name,parent_id FROM organizations WHERE $1 OR id::text=ANY($2::text[]) ORDER BY name',
        [all, own.map((g) => g.scope)],
      );
      res.json({ data: rows.rows });
    }),
  );
  router.get(
    '/api/v2/access/members',
    endpoint(async (req, res) => {
      const user = await principal(req);
      const scope = z.string().uuid().parse(req.query.scope);
      await authorize(user, 'membership.manage', scope);
      res.json({
        data: (
          await pool.query(
            'SELECT public_id,role FROM role_grants WHERE scope=$1 ORDER BY public_id',
            [scope],
          )
        ).rows,
      });
    }),
  );
  router.post(
    '/api/v2/access/organizations',
    endpoint(async (req, res) => {
      const user = await principal(req);
      await authorize(user, 'organization.manage', 'platform');
      const data = z
        .object({
          name: z.string().trim().min(1).max(120),
          parent_id: z.string().uuid().nullable().default(null),
        })
        .strict()
        .parse(req.body);
      const id = randomUUID();
      await transaction(pool, async (db) => {
        if (
          data.parent_id &&
          !(
            await db.query('SELECT 1 FROM organizations WHERE id=$1 AND parent_id IS NULL', [
              data.parent_id,
            ])
          ).rowCount
        )
          throw new ServiceError(400, 'INVALID_INPUT');
        await db.query('INSERT INTO organizations(id,name,parent_id) VALUES($1,$2,$3)', [
          id,
          data.name,
          data.parent_id,
        ]);
        await db.query(
          "INSERT INTO organization_audit(actor_id,target_id,action,scope) VALUES($1,$2,'organization_created','platform')",
          [user.id, id],
        );
      });
      res.status(201).json({ data: { id } });
    }),
  );
  router.get(
    '/api/v2/access/audit',
    endpoint(async (req, res) => {
      const user = await principal(req);
      await authorize(user, 'audit.read', 'platform');
      res.json({
        data: (
          await pool.query(
            'SELECT id,action,scope,occurred_at FROM organization_audit ORDER BY id DESC LIMIT 100',
          )
        ).rows,
      });
    }),
  );
  return router;
}
