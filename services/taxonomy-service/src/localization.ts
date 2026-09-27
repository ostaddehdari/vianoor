import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  internalRouter,
  endpoint,
  requirePermission,
  transaction,
  ServiceError,
} from '@vianoor/service-runtime';
import { languageCodes, languageMetadata } from './language-seed.js';

export const languageCode = z
  .string()
  .max(35)
  .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
  .refine((value) => {
    try {
      return !!Intl.getCanonicalLocales(value)[0];
    } catch {
      return false;
    }
  }, 'Invalid language code')
  .transform((value) => Intl.getCanonicalLocales(value)[0]!);
const text = z.string().trim().min(1).max(20000);
const keyName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,199}$/);
const offset = z.coerce.number().int().min(0).max(100000).default(0);
const languageInput = z
  .object({
    code: languageCode,
    name_en: z.string().trim().min(1).max(120),
    native_name: z.string().trim().min(1).max(120).nullable(),
    direction: z.enum(['LTR', 'RTL']),
    status: z.enum(['ACTIVE', 'INACTIVE']),
    ai_supported: z.boolean(),
    speech_supported: z.boolean(),
    translation_supported: z.boolean(),
  })
  .strict();
export function placeholders(value: string) {
  return [...new Set(value.match(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g) ?? [])].sort();
}
export function validateTranslation(source: string, value: string) {
  if (JSON.stringify(placeholders(source)) !== JSON.stringify(placeholders(value)))
    throw new ServiceError(400, 'PLACEHOLDER_MISMATCH');
}
async function activeLanguage(db: Pool | PoolClient, code: string) {
  const row = (await db.query("SELECT * FROM languages WHERE code=$1 AND status='ACTIVE'", [code]))
    .rows[0];
  if (!row) throw new ServiceError(404, 'LANGUAGE_UNAVAILABLE');
  return row;
}
async function audit(db: PoolClient, actor: string, target: string, action: string) {
  await db.query('INSERT INTO localization_audit(actor_id,target,action) VALUES($1,$2,$3)', [
    actor,
    target,
    action,
  ]);
  await db.query('UPDATE localization_state SET revision=revision+1 WHERE id=1');
}
export async function initializeLocalization(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS languages(id uuid PRIMARY KEY,code text UNIQUE NOT NULL,name_en text NOT NULL,native_name text,direction text NOT NULL CHECK(direction IN ('RTL','LTR')),status text NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')),ai_supported boolean NOT NULL DEFAULT false,speech_supported boolean NOT NULL DEFAULT false,translation_supported boolean NOT NULL DEFAULT true,revision int NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS translation_keys(id uuid PRIMARY KEY,key text UNIQUE NOT NULL,type text NOT NULL DEFAULT 'UI',module text NOT NULL,reference_id uuid,default_language text NOT NULL DEFAULT 'en' CHECK(default_language='en'),default_value text NOT NULL,revision int NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS translations(key_id uuid REFERENCES translation_keys(id),language text REFERENCES languages(code),value text NOT NULL,status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','AI_TRANSLATED','HUMAN_REVIEWED','APPROVED')),source_revision int NOT NULL,revision int NOT NULL DEFAULT 1,published_value text,published_source_revision int,editor_id uuid,reviewer_id uuid,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(key_id,language));
    CREATE INDEX IF NOT EXISTS translation_language_status ON translations(language,status);
    CREATE TABLE IF NOT EXISTS localization_state(id int PRIMARY KEY CHECK(id=1),revision bigint NOT NULL DEFAULT 1);
    INSERT INTO localization_state(id) VALUES(1) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS localization_audit(id bigserial PRIMARY KEY,actor_id uuid NOT NULL,target text NOT NULL,action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS translation_jobs(id uuid PRIMARY KEY,key_id uuid REFERENCES translation_keys(id),target_language text REFERENCES languages(code),source_revision int NOT NULL,source_language text NOT NULL DEFAULT 'en',status text NOT NULL DEFAULT 'WAITING_FOR_PROVIDER',provider text,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(key_id,target_language,source_revision));
    CREATE TABLE IF NOT EXISTS specialty_translations(entry_id uuid REFERENCES taxonomy_entries(id),language text REFERENCES languages(code),value text NOT NULL,status text NOT NULL DEFAULT 'DRAFT',source_revision int NOT NULL,revision int NOT NULL DEFAULT 1,published_value text,published_source_revision int,editor_id uuid,reviewer_id uuid,PRIMARY KEY(entry_id,language));`);
  await transaction(pool, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(10001)');
    for (const code of languageCodes) {
      const item = languageMetadata(code);
      const old = (
        await db.query(
          "SELECT id,active FROM taxonomy_entries WHERE kind='language' AND lower(label->>'en')=lower($1) ORDER BY id LIMIT 1",
          [item.name_en],
        )
      ).rows[0];
      const id = old?.id ?? randomUUID();
      await db.query(
        'INSERT INTO languages(id,code,name_en,native_name,direction,status) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(code) DO NOTHING',
        [
          id,
          code,
          item.name_en,
          item.native_name,
          item.direction,
          old?.active === false && code !== 'en' ? 'INACTIVE' : item.status,
        ],
      );
      const language = (await db.query('SELECT * FROM languages WHERE code=$1', [code])).rows[0];
      await db.query(
        "INSERT INTO taxonomy_entries(id,kind,label,active,position,icon) VALUES($1,'language',$2,$3,0,'') ON CONFLICT(id) DO NOTHING",
        [
          language.id,
          { en: item.name_en, fa: new Intl.DisplayNames(['fa'], { type: 'language' }).of(code) },
          language.status === 'ACTIVE',
        ],
      );
    }
  });
}

export function localizationRouter(pool: Pool) {
  const router = internalRouter('3mb');
  router.get(
    '/api/v2/languages',
    endpoint(async (req, res) => {
      const admin = req.query.admin === '1';
      if (admin) await requirePermission(req, 'translation.manage');
      const languages = (
        await pool.query("SELECT * FROM languages WHERE $1 OR status='ACTIVE' ORDER BY code", [
          admin,
        ])
      ).rows;
      res.json({ data: languages });
    }),
  );
  router.get(
    '/api/v2/languages/:code',
    endpoint(async (req, res) =>
      res.json({ data: await activeLanguage(pool, languageCode.parse(req.params.code)) }),
    ),
  );
  router.post(
    '/api/v2/languages',
    endpoint(async (req, res) => {
      const actor = await requirePermission(req, 'translation.manage'),
        input = languageInput.parse(req.body);
      await transaction(pool, async (db) => {
        const id = randomUUID();
        const row = await db.query(
          'INSERT INTO languages(id,code,name_en,native_name,direction,status,ai_supported,speech_supported,translation_supported) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(code) DO NOTHING RETURNING id',
          [
            id,
            input.code,
            input.name_en,
            input.native_name,
            input.direction,
            input.status,
            input.ai_supported,
            input.speech_supported,
            input.translation_supported,
          ],
        );
        if (!row.rowCount) throw new ServiceError(409, 'CONFLICT');
        await db.query(
          "INSERT INTO taxonomy_entries(id,kind,label,active,position,icon) VALUES($1,'language',$2,$3,0,'')",
          [
            id,
            { en: input.name_en, fa: input.native_name ?? input.name_en },
            input.status === 'ACTIVE',
          ],
        );
        await audit(db, actor.id, input.code, 'language.created');
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.put(
    '/api/v2/languages/:code',
    endpoint(async (req, res) => {
      const actor = await requirePermission(req, 'translation.manage'),
        input = languageInput.extend({ revision: z.number().int().positive() }).parse(req.body),
        code = languageCode.parse(req.params.code);
      if (input.code !== code || (code === 'en' && input.status !== 'ACTIVE'))
        throw new ServiceError(400, 'INVALID_INPUT');
      await transaction(pool, async (db) => {
        const row = (
          await db.query(
            'UPDATE languages SET name_en=$2,native_name=$3,direction=$4,status=$5,ai_supported=$6,speech_supported=$7,translation_supported=$8,revision=revision+1 WHERE code=$1 AND revision=$9 RETURNING id',
            [
              code,
              input.name_en,
              input.native_name,
              input.direction,
              input.status,
              input.ai_supported,
              input.speech_supported,
              input.translation_supported,
              input.revision,
            ],
          )
        ).rows[0];
        if (!row) throw new ServiceError(409, 'CONFLICT');
        await db.query(
          'UPDATE taxonomy_entries SET active=$2,label=$3,revision=revision+1 WHERE id=$1',
          [
            row.id,
            input.status === 'ACTIVE',
            { en: input.name_en, fa: input.native_name ?? input.name_en },
          ],
        );
        await audit(db, actor.id, code, 'language.updated');
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.get(
    '/api/v2/localization/bundle',
    endpoint(async (req, res) => {
      const code = languageCode.parse(req.query.language ?? 'en'),
        language = await activeLanguage(pool, code);
      const rows = (
        await pool.query(
          "SELECT k.key,k.default_value,CASE WHEN t.published_source_revision=k.revision THEN t.published_value ELSE NULL END AS translated FROM translation_keys k LEFT JOIN translations t ON t.key_id=k.id AND t.language=$1 WHERE k.type='UI' ORDER BY k.key",
          [code],
        )
      ).rows;
      const revision = (await pool.query('SELECT revision FROM localization_state WHERE id=1'))
        .rows[0].revision;
      res.json({
        data: {
          language,
          revision,
          values: Object.fromEntries(rows.map((r) => [r.key, r.translated ?? r.default_value])),
          fallback_keys: rows.filter((r) => code !== 'en' && !r.translated).map((r) => r.key),
        },
      });
    }),
  );
  router.get(
    '/api/v2/localization/translation',
    endpoint(async (req, res) => {
      const code = languageCode.parse(req.query.language ?? 'en');
      await activeLanguage(pool, code);
      const row = (
        await pool.query(
          "SELECT k.key,k.default_value,CASE WHEN t.published_source_revision=k.revision THEN t.published_value ELSE NULL END AS translated FROM translation_keys k LEFT JOIN translations t ON t.key_id=k.id AND t.language=$2 WHERE k.key=$1 AND k.type='UI'",
          [keyName.parse(req.query.key), code],
        )
      ).rows[0];
      if (!row) throw new ServiceError(404, 'NOT_FOUND');
      res.json({
        data: {
          key: row.key,
          language: row.translated ? code : 'en',
          value: row.translated ?? row.default_value,
          fallback: code !== 'en' && !row.translated,
        },
      });
    }),
  );
  router.get(
    '/api/v2/localization/coverage',
    endpoint(async (req, res) => {
      await requirePermission(req, 'translation.manage');
      res.json({
        data: (
          await pool.query(
            "SELECT l.code,l.name_en,l.native_name,l.status,count(k.id)::int AS total,count(t.key_id) FILTER(WHERE t.published_source_revision=k.revision AND t.published_value IS NOT NULL)::int AS approved FROM languages l CROSS JOIN translation_keys k LEFT JOIN translations t ON t.key_id=k.id AND t.language=l.code WHERE k.type='UI' GROUP BY l.id ORDER BY l.code",
          )
        ).rows,
      });
    }),
  );
  router.get(
    '/api/v2/localization/keys',
    endpoint(async (req, res) => {
      await requirePermission(req, 'translation.manage');
      const q = z
        .object({
          language: languageCode.default('en'),
          query: z.string().max(200).default(''),
          missing: z.enum(['0', '1']).default('0'),
          offset,
        })
        .strict()
        .parse(req.query);
      await activeLanguage(pool, q.language);
      res.json({
        data: (
          await pool.query(
            "SELECT k.*,t.value,t.status,t.source_revision,t.revision AS translation_revision,t.published_value,t.published_source_revision FROM translation_keys k LEFT JOIN translations t ON t.key_id=k.id AND t.language=$1 WHERE (k.key ILIKE '%'||$2||'%' OR k.default_value ILIKE '%'||$2||'%') AND ($3='0' OR t.published_source_revision IS DISTINCT FROM k.revision) ORDER BY k.key LIMIT 100 OFFSET $4",
            [q.language, q.query, q.missing, q.offset],
          )
        ).rows,
      });
    }),
  );
  router.post(
    '/api/v2/localization/keys',
    endpoint(async (req, res) => {
      const actor = await requirePermission(req, 'translation.manage'),
        input = z
          .object({ key: keyName, module: z.string().regex(/^[a-z][a-z0-9-]{0,59}$/), value: text })
          .strict()
          .parse(req.body);
      await transaction(pool, async (db) => {
        const id = randomUUID();
        if (
          !(
            await db.query(
              'INSERT INTO translation_keys(id,key,module,default_value) VALUES($1,$2,$3,$4) ON CONFLICT(key) DO NOTHING RETURNING id',
              [id, input.key, input.module, input.value],
            )
          ).rowCount
        )
          throw new ServiceError(409, 'CONFLICT');
        await db.query(
          "INSERT INTO translations(key_id,language,value,status,source_revision,published_value,published_source_revision,editor_id) VALUES($1,'en',$2,'APPROVED',1,$2,1,$3)",
          [id, input.value, actor.id],
        );
        await audit(db, actor.id, input.key, 'key.created');
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.put(
    '/api/v2/localization/keys/:id',
    endpoint(async (req, res) => {
      const actor = await requirePermission(req, 'translation.manage'),
        id = z.string().uuid().parse(req.params.id),
        input = z
          .object({ value: text, revision: z.number().int().positive() })
          .strict()
          .parse(req.body);
      await transaction(pool, async (db) => {
        const row = (
          await db.query(
            'UPDATE translation_keys SET default_value=$2,revision=revision+1 WHERE id=$1 AND revision=$3 RETURNING *',
            [id, input.value, input.revision],
          )
        ).rows[0];
        if (!row) throw new ServiceError(409, 'CONFLICT');
        await db.query(
          "INSERT INTO translations(key_id,language,value,status,source_revision,published_value,published_source_revision,editor_id) VALUES($1,'en',$2,'APPROVED',$3,$2,$3,$4) ON CONFLICT(key_id,language) DO UPDATE SET value=$2,status='APPROVED',source_revision=$3,published_value=$2,published_source_revision=$3,revision=translations.revision+1,editor_id=$4",
          [id, input.value, row.revision, actor.id],
        );
        await audit(db, actor.id, row.key, 'source.updated');
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.post(
    '/api/v2/localization/translation',
    endpoint(async (req, res) => {
      const actor = await requirePermission(req, 'translation.manage'),
        input = z
          .object({
            key_id: z.string().uuid(),
            language: languageCode,
            value: text,
            source_revision: z.number().int().positive(),
            revision: z.number().int().nonnegative(),
          })
          .strict()
          .parse(req.body);
      if (input.language === 'en') throw new ServiceError(400, 'EDIT_SOURCE_INSTEAD');
      await transaction(pool, async (db) => {
        await activeLanguage(db, input.language);
        const key = (
          await db.query('SELECT * FROM translation_keys WHERE id=$1 FOR UPDATE', [input.key_id])
        ).rows[0];
        if (!key) throw new ServiceError(404, 'NOT_FOUND');
        if (key.revision !== input.source_revision) throw new ServiceError(409, 'STALE_SOURCE');
        validateTranslation(key.default_value, input.value);
        const old = (
          await db.query('SELECT revision FROM translations WHERE key_id=$1 AND language=$2', [
            key.id,
            input.language,
          ])
        ).rows[0];
        if ((old?.revision ?? 0) !== input.revision) throw new ServiceError(409, 'CONFLICT');
        await db.query(
          "INSERT INTO translations(key_id,language,value,source_revision,editor_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(key_id,language) DO UPDATE SET value=$3,status='DRAFT',source_revision=$4,revision=translations.revision+1,editor_id=$5,reviewer_id=NULL,updated_at=now()",
          [key.id, input.language, input.value, key.revision, actor.id],
        );
        await audit(db, actor.id, key.key + ':' + input.language, 'translation.draft');
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.post(
    '/api/v2/localization/review',
    endpoint(async (req, res) => {
      const actor = await requirePermission(req, 'translation.review'),
        input = z
          .object({
            key_id: z.string().uuid(),
            language: languageCode,
            status: z.enum(['HUMAN_REVIEWED', 'APPROVED']),
            revision: z.number().int().positive(),
          })
          .strict()
          .parse(req.body);
      await transaction(pool, async (db) => {
        await activeLanguage(db, input.language);
        const key = (
          await db.query('SELECT * FROM translation_keys WHERE id=$1 FOR UPDATE', [input.key_id])
        ).rows[0];
        const old = (
          await db.query('SELECT * FROM translations WHERE key_id=$1 AND language=$2 FOR UPDATE', [
            input.key_id,
            input.language,
          ])
        ).rows[0];
        if (!key || !old) throw new ServiceError(404, 'NOT_FOUND');
        if (key.revision !== old.source_revision) throw new ServiceError(409, 'STALE_SOURCE');
        if (
          old.revision !== input.revision ||
          (input.status === 'APPROVED'
            ? old.status !== 'HUMAN_REVIEWED'
            : !['DRAFT', 'AI_TRANSLATED'].includes(old.status))
        )
          throw new ServiceError(409, 'CONFLICT');
        validateTranslation(key.default_value, old.value);
        await db.query(
          "UPDATE translations SET status=$3,revision=revision+1,reviewer_id=$4,published_value=CASE WHEN $3='APPROVED' THEN value ELSE published_value END,published_source_revision=CASE WHEN $3='APPROVED' THEN source_revision ELSE published_source_revision END,updated_at=now() WHERE key_id=$1 AND language=$2",
          [input.key_id, input.language, input.status, actor.id],
        );
        await audit(db, actor.id, key.key + ':' + input.language, 'translation.' + input.status);
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.get(
    '/api/v2/localization/jobs',
    endpoint(async (req, res) => {
      await requirePermission(req, 'translation.manage');
      res.json({
        data: (
          await pool.query(
            'SELECT j.*,k.key FROM translation_jobs j JOIN translation_keys k ON k.id=j.key_id ORDER BY created_at DESC LIMIT 100',
          )
        ).rows,
      });
    }),
  );
  router.post(
    '/api/v2/localization/jobs',
    endpoint(async (req, res) => {
      const actor = await requirePermission(req, 'translation.manage'),
        input = z
          .object({ key_id: z.string().uuid(), target_language: languageCode })
          .strict()
          .parse(req.body);
      await transaction(pool, async (db) => {
        const language = await activeLanguage(db, input.target_language);
        if (!language.translation_supported) throw new ServiceError(400, 'TRANSLATION_UNSUPPORTED');
        const key = (await db.query('SELECT * FROM translation_keys WHERE id=$1', [input.key_id]))
          .rows[0];
        if (!key) throw new ServiceError(404, 'NOT_FOUND');
        await db.query(
          'INSERT INTO translation_jobs(id,key_id,target_language,source_revision,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(key_id,target_language,source_revision) DO NOTHING',
          [randomUUID(), key.id, input.target_language, key.revision, actor.id],
        );
        await audit(db, actor.id, key.key, 'job.waiting_for_provider');
      });
      res.json({ data: { status: 'WAITING_FOR_PROVIDER' } });
    }),
  );
  router.post(
    '/internal/localization/bootstrap',
    endpoint(async (req, res) => {
      const items = z
        .array(
          z
            .object({
              key: keyName,
              module: z.string().min(1).max(60),
              en: text,
              fa: text.optional(),
              ar: text.optional(),
            })
            .strict(),
        )
        .max(200)
        .parse(req.body.items);
      await transaction(pool, async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(10001)');
        for (const item of items) {
          const row = (
            await db.query(
              'INSERT INTO translation_keys(id,key,module,default_value) VALUES($1,$2,$3,$4) ON CONFLICT(key) DO NOTHING RETURNING id',
              [randomUUID(), item.key, item.module, item.en],
            )
          ).rows[0];
          if (!row) continue;
          for (const code of ['en', 'fa', 'ar'] as const) {
            const value = item[code];
            if (!value) continue;
            validateTranslation(item.en, value);
            await db.query(
              "INSERT INTO translations(key_id,language,value,status,source_revision,published_value,published_source_revision) VALUES($1,$2,$3,'APPROVED',1,$3,1)",
              [row.id, code, value],
            );
          }
        }
        await db.query('UPDATE localization_state SET revision=revision+1 WHERE id=1');
      });
      res.json({ data: { ok: true } });
    }),
  );
  return router;
}
