import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Pool } from 'pg';
import {
  internalRouter,
  endpoint,
  principal,
  requirePermission,
  internalCall,
  ServiceError,
  transaction,
  type Principal,
} from '@vianoor/service-runtime';
import { formSchema, defaultForm, validateAnswers, type ProfileForm } from './forms.js';
const code = z.string().regex(/^[A-Za-z0-9]{13}$/);
const avatarSchema = z.union([
  z.object({ kind: z.literal('preset'), value: z.enum(['1', '2', '3', '4', '5']) }).strict(),
  z.object({ kind: z.literal('upload'), value: z.string().uuid() }).strict(),
]);
export async function initializeProfile(pool: Pool) {
  await transaction(pool, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(20260602)');
    await db.query(`CREATE TABLE IF NOT EXISTS profile_forms (
      id uuid PRIMARY KEY, draft jsonb NOT NULL, revision int NOT NULL DEFAULT 1, published int NOT NULL DEFAULT 0,
      is_default boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
      CREATE UNIQUE INDEX IF NOT EXISTS one_default_profile_form ON profile_forms(is_default) WHERE is_default;
      CREATE TABLE IF NOT EXISTS profile_form_versions (form_id uuid REFERENCES profile_forms(id), version int NOT NULL,
        definition jsonb NOT NULL, published_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(form_id,version));
      CREATE TABLE IF NOT EXISTS profiles (account_id uuid PRIMARY KEY, public_id varchar(13) UNIQUE NOT NULL,
        display_name varchar(100) NOT NULL DEFAULT '', avatar jsonb NOT NULL DEFAULT '{"kind":"preset","value":"1"}',
        answers jsonb NOT NULL DEFAULT '{}', form_id uuid REFERENCES profile_forms(id), saved_version int NOT NULL DEFAULT 0,
        revision int NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS profile_audit (id bigserial PRIMARY KEY, actor_id uuid NOT NULL,
        target_id text NOT NULL, action text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS profile_submissions (account_id uuid NOT NULL, revision int NOT NULL,
        form_id uuid, form_version int NOT NULL, answers jsonb NOT NULL, saved_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(account_id,revision));`);
    if (!(await db.query('SELECT 1 FROM profile_forms WHERE is_default')).rowCount) {
      const id = randomUUID();
      await db.query(
        'INSERT INTO profile_forms(id,draft,published,is_default) VALUES($1,$2,1,true)',
        [id, defaultForm],
      );
      await db.query(
        'INSERT INTO profile_form_versions(form_id,version,definition) VALUES($1,1,$2)',
        [id, defaultForm],
      );
    }
  });
}
export function profileRouter(pool: Pool) {
  const router = internalRouter();
  async function ensure(user: { id: string; public_id: string }) {
    await pool.query(
      'INSERT INTO profiles(account_id,public_id) VALUES($1,$2) ON CONFLICT(account_id) DO NOTHING',
      [user.id, user.public_id],
    );
  }
  async function load(public_id: string) {
    const profile = (await pool.query('SELECT * FROM profiles WHERE public_id=$1', [public_id]))
      .rows[0];
    if (!profile) throw new ServiceError(404, 'NOT_FOUND');
    const form = (
      await pool.query(
        `SELECT f.id,f.published,v.definition FROM profile_forms f
      JOIN profile_form_versions v ON v.form_id=f.id AND v.version=f.published
      WHERE ($1::uuid IS NOT NULL AND f.id=$1) OR ($1::uuid IS NULL AND f.is_default)`,
        [profile.form_id],
      )
    ).rows[0];
    if (!form) throw new ServiceError(503, 'FORM_NOT_PUBLISHED');
    const definition = form.definition as ProfileForm;
    // Removed fields never escape via old saved answers.
    const known = new Set(definition.sections.flatMap((s) => s.fields.map((f) => f.id)));
    const current = Object.fromEntries(
      Object.entries(profile.answers).filter(([key]) => known.has(key)),
    );
    let missing: string[] = [];
    try {
      missing = validateAnswers(definition, current, false).missing;
    } catch {
      missing = ['invalid'];
    }
    const complete =
      !!profile.display_name && profile.saved_version === form.published && !missing.length;
    return {
      public_id,
      display_name: profile.display_name,
      avatar: profile.avatar,
      answers: current,
      revision: profile.revision,
      saved_version: profile.saved_version,
      form: { id: form.id, version: form.published, definition },
      complete,
      missing,
    };
  }
  router.post(
    '/internal/image-visible',
    endpoint(async (req, res) => {
      await principal(req);
      const data = z.object({ public_id: code, id: z.string().uuid() }).strict().parse(req.body);
      const sharing = await internalCall<{ accepted: boolean }>(
        'consent-service',
        '/internal/profile-sharing/' + data.public_id,
      );
      if (!sharing.accepted) throw new ServiceError(403, 'FORBIDDEN');
      const profile = await load(data.public_id);
      const visible = profile.form.definition.sections
        .flatMap((s) => s.fields)
        .some(
          (f) =>
            f.type === 'image' &&
            f.visibility === 'members' &&
            profile.answers[f.id] === data.id &&
            (!f.showWhen || profile.answers[f.showWhen.field] === f.showWhen.equals),
        );
      if (!visible) throw new ServiceError(403, 'FORBIDDEN');
      res.json({ data: { ok: true } });
    }),
  );
  router.get(
    '/api/v2/profiles/me',
    endpoint(async (req, res) => {
      const user = await principal(req);
      await ensure(user);
      res.json({ data: await load(user.public_id) });
    }),
  );
  router.get(
    '/api/v2/profiles/experts',
    endpoint(async (req, res) => {
      await principal(req);
      const experts = await internalCall<{ public_id: string }[]>(
        'organization-service',
        '/internal/experts',
      );
      const visible = [];
      for (const expert of experts) {
        const account = await internalCall<{
          id: string;
          public_id: string;
          disabled_at: string | null;
          verified_at: string | null;
        }>('identity-service', '/internal/accounts/' + expert.public_id);
        if (account.disabled_at || !account.verified_at) continue;
        await ensure(account);
        const profile = await load(expert.public_id);
        const sharing = await internalCall<{ accepted: boolean }>(
          'consent-service',
          '/internal/profile-sharing/' + expert.public_id,
        );
        visible.push({
          public_id: profile.public_id,
          display_name: sharing.accepted ? profile.display_name : '',
          avatar: sharing.accepted ? profile.avatar : { kind: 'preset', value: '1' },
        });
      }
      res.json({ data: visible });
    }),
  );
  router.get(
    '/internal/profile-ready',
    endpoint(async (req, res) => {
      const user = await principal(req);
      await ensure(user);
      const profile = await load(user.public_id);
      if (!profile.complete) throw new ServiceError(409, 'PROFILE_INCOMPLETE');
      await internalCall(
        'consent-service',
        '/internal/profile-consent',
        req.get('authorization') ?? '',
      );
      res.json({ data: { public_id: user.public_id } });
    }),
  );
  router.get(
    '/api/v2/profiles/member/:code',
    endpoint(async (req, res) => {
      const user = await principal(req);
      const id = code.parse(req.params.code);
      const account = await internalCall<{
        id: string;
        public_id: string;
        disabled_at: string | null;
      }>('identity-service', '/internal/accounts/' + id);
      if (account.disabled_at) throw new ServiceError(404, 'NOT_FOUND');
      await ensure(account);
      const profile = await load(id);
      if (user.public_id === id) {
        res.json({ data: profile });
        return;
      }
      const sharing = await internalCall<{ accepted: boolean }>(
        'consent-service',
        '/internal/profile-sharing/' + id,
      );
      if (!sharing.accepted) {
        res.json({
          data: {
            public_id: id,
            display_name: '',
            avatar: { kind: 'preset', value: '1' },
            fields: [],
          },
        });
        return;
      }
      const fields = profile.form.definition.sections
        .flatMap((s) => s.fields)
        .filter(
          (f) =>
            f.visibility === 'members' &&
            (!f.showWhen || profile.answers[f.showWhen.field] === f.showWhen.equals),
        );
      res.json({
        data: {
          public_id: id,
          display_name: profile.display_name,
          avatar: profile.avatar,
          fields: fields.map((f) => ({
            id: f.id,
            label: f.label,
            type: f.type,
            options: f.options,
            value: profile.answers[f.id] ?? null,
          })),
        },
      });
    }),
  );
  router.get(
    '/api/v2/profiles/admin/:code',
    endpoint(async (req, res) => {
      await requirePermission(req, 'users.manage');
      const id = code.parse(req.params.code);
      const account = await internalCall<Principal>('identity-service', '/internal/accounts/' + id);
      await ensure(account);
      res.json({ data: await load(id) });
    }),
  );
  const saveSchema = z
    .object({
      display_name: z.string().trim().min(1).max(100),
      avatar: avatarSchema,
      answers: z.record(z.string(), z.unknown()),
      version: z.number().int().positive(),
      revision: z.number().int().min(0),
      complete: z.boolean().default(false),
    })
    .strict();
  for (const route of ['/api/v2/profiles/me', '/api/v2/profiles/admin/:code'])
    router.put(
      route,
      endpoint(async (req, res) => {
        const actor = route.endsWith(':code')
          ? await requirePermission(req, 'users.manage')
          : await principal(req);
        const id = route.endsWith(':code') ? code.parse(req.params.code) : actor.public_id;
        const owner =
          id === actor.public_id
            ? actor
            : await internalCall<Principal>('identity-service', '/internal/accounts/' + id);
        await ensure(owner);
        const data = saveSchema.parse(req.body);
        const current = await load(id);
        if (data.version !== current.form.version) throw new ServiceError(409, 'FORM_CHANGED');
        let parsed;
        try {
          parsed = validateAnswers(current.form.definition, data.answers, data.complete);
        } catch (e) {
          throw new ServiceError(400, e instanceof Error ? e.message : 'INVALID_ANSWERS');
        }
        const images = current.form.definition.sections
          .flatMap((s) => s.fields)
          .filter((f) => f.type === 'image')
          .map((f) => parsed.answers[f.id])
          .filter(Boolean);
        if (data.avatar.kind === 'upload') images.push(data.avatar.value);
        for (const image of images)
          await internalCall(
            'file-service',
            '/internal/owned-image',
            req.get('authorization') ?? '',
            {
              id: image,
              public_id: id,
              avatar: data.avatar.kind === 'upload' && image === data.avatar.value,
            },
          );
        await transaction(pool, async (db) => {
          // Lock the form while checking its version and saving to prevent a publish/save race.
          const fresh = (
            await db.query('SELECT published FROM profile_forms WHERE id=$1 FOR SHARE', [
              current.form.id,
            ])
          ).rows[0];
          if (fresh.published !== data.version) throw new ServiceError(409, 'FORM_CHANGED');
          await db.query(
            `INSERT INTO profile_submissions(account_id,revision,form_id,form_version,answers)
        SELECT account_id,revision,COALESCE(form_id,$2),saved_version,answers FROM profiles WHERE public_id=$1 ON CONFLICT DO NOTHING`,
            [id, current.form.id],
          );
          const updated = await db.query(
            `UPDATE profiles SET display_name=$2,avatar=$3,answers=$4,saved_version=$5,revision=revision+1,updated_at=now()
        WHERE public_id=$1 AND revision=$6 RETURNING public_id`,
            [id, data.display_name, data.avatar, parsed.answers, data.version, data.revision],
          );
          if (!updated.rowCount) throw new ServiceError(409, 'CONFLICT');
          await db.query('INSERT INTO profile_audit(actor_id,target_id,action) VALUES($1,$2,$3)', [
            actor.id,
            id,
            id === actor.public_id ? 'profile_updated' : 'admin_profile_updated',
          ]);
        });
        res.json({ data: await load(id) });
      }),
    );
  router.get(
    '/api/v2/profiles/forms',
    endpoint(async (req, res) => {
      await requirePermission(req, 'forms.manage');
      res.json({
        data: (
          await pool.query(
            'SELECT id,draft,revision,published,is_default FROM profile_forms ORDER BY created_at',
          )
        ).rows,
      });
    }),
  );
  router.post(
    '/api/v2/profiles/forms',
    endpoint(async (req, res) => {
      const user = await requirePermission(req, 'forms.manage');
      const form = formSchema.parse(req.body);
      const id = randomUUID();
      await transaction(pool, async (db) => {
        await db.query('INSERT INTO profile_forms(id,draft) VALUES($1,$2)', [id, form]);
        await db.query(
          "INSERT INTO profile_audit(actor_id,target_id,action) VALUES($1,$2,'form_created')",
          [user.id, id],
        );
      });
      res.status(201).json({ data: { id } });
    }),
  );
  router.put(
    '/api/v2/profiles/forms/:id',
    endpoint(async (req, res) => {
      const user = await requirePermission(req, 'forms.manage');
      const id = z.string().uuid().parse(req.params.id);
      const data = z
        .object({ definition: formSchema, revision: z.number().int().positive() })
        .strict()
        .parse(req.body);
      await transaction(pool, async (db) => {
        const updated = await db.query(
          'UPDATE profile_forms SET draft=$2,revision=revision+1 WHERE id=$1 AND revision=$3 RETURNING id',
          [id, data.definition, data.revision],
        );
        if (!updated.rowCount) throw new ServiceError(409, 'CONFLICT');
        await db.query(
          "INSERT INTO profile_audit(actor_id,target_id,action) VALUES($1,$2,'form_draft_saved')",
          [user.id, id],
        );
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.post(
    '/api/v2/profiles/forms/:id/publish',
    endpoint(async (req, res) => {
      const user = await requirePermission(req, 'forms.manage');
      const id = z.string().uuid().parse(req.params.id);
      const data = z.object({ revision: z.number().int().positive() }).strict().parse(req.body);
      await transaction(pool, async (db) => {
        const form = (await db.query('SELECT * FROM profile_forms WHERE id=$1 FOR UPDATE', [id]))
          .rows[0];
        if (!form) throw new ServiceError(404, 'NOT_FOUND');
        if (form.revision !== data.revision) throw new ServiceError(409, 'CONFLICT');
        const definition = formSchema.parse(form.draft);
        await db.query(
          'INSERT INTO profile_form_versions(form_id,version,definition) VALUES($1,$2,$3)',
          [id, form.published + 1, definition],
        );
        await db.query(
          'UPDATE profile_forms SET published=published+1,revision=revision+1 WHERE id=$1',
          [id],
        );
        await db.query(
          "INSERT INTO profile_audit(actor_id,target_id,action) VALUES($1,$2,'form_published')",
          [user.id, id],
        );
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.post(
    '/api/v2/profiles/assign',
    endpoint(async (req, res) => {
      const actor = await requirePermission(req, 'users.manage');
      const data = z
        .object({ public_id: code, form_id: z.string().uuid() })
        .strict()
        .parse(req.body);
      const owner = await internalCall<Principal>(
        'identity-service',
        '/internal/accounts/' + data.public_id,
      );
      await ensure(owner);
      await transaction(pool, async (db) => {
        if (
          !(
            await db.query('SELECT 1 FROM profile_forms WHERE id=$1 AND published>0 FOR SHARE', [
              data.form_id,
            ])
          ).rowCount
        )
          throw new ServiceError(409, 'FORM_NOT_PUBLISHED');
        await db.query(
          `INSERT INTO profile_submissions(account_id,revision,form_id,form_version,answers)
        SELECT account_id,revision,COALESCE(form_id,(SELECT id FROM profile_forms WHERE is_default)),saved_version,answers FROM profiles WHERE public_id=$1 ON CONFLICT DO NOTHING`,
          [data.public_id],
        );
        await db.query(
          "UPDATE profiles SET form_id=$2,saved_version=0,answers='{}',revision=revision+1 WHERE public_id=$1",
          [data.public_id, data.form_id],
        );
        await db.query(
          "INSERT INTO profile_audit(actor_id,target_id,action) VALUES($1,$2,'form_assigned')",
          [actor.id, data.public_id],
        );
      });
      res.json({ data: { ok: true } });
    }),
  );
  return router;
}
