import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  internalRouter,
  endpoint,
  principal,
  requirePermission,
  internalCall,
  transaction,
  ServiceError,
} from '@vianoor/service-runtime';
const language = z
  .string()
  .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
  .max(35);
const code = z.string().regex(/^[A-Za-z0-9]{13}$/);
export const expertTextFields = [
  'display_name',
  'title',
  'short_bio',
  'biography',
  'experience',
  'education',
  'city',
  'country',
  'seo_title',
  'seo_description',
] as const;
export const serviceTextFields = ['title', 'summary', 'description', 'terms'] as const;
function textFields(value: Record<string, unknown>, kind: string): Record<string, string> {
  return Object.fromEntries(
    (kind === 'expert' ? expertTextFields : serviceTextFields).map((field) => [
      field,
      typeof value[field] === 'string' ? value[field] : '',
    ]),
  );
}
export function sourceHash(fields: Record<string, string>) {
  return createHash('sha256')
    .update(JSON.stringify(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b))))
    .digest('hex');
}
export async function initializeDiscovery(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS expert_translations(expert_id uuid REFERENCES scholars(id),language text NOT NULL,fields jsonb NOT NULL,status text NOT NULL DEFAULT 'DRAFT',source_hash text NOT NULL,revision int NOT NULL DEFAULT 1,published_fields jsonb,published_source_hash text,editor_id uuid,reviewer_id uuid,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(expert_id,language));
  CREATE TABLE IF NOT EXISTS service_translations(service_id uuid REFERENCES scholar_offerings(id),language text NOT NULL,fields jsonb NOT NULL,status text NOT NULL DEFAULT 'DRAFT',source_hash text NOT NULL,revision int NOT NULL DEFAULT 1,published_fields jsonb,published_source_hash text,editor_id uuid,reviewer_id uuid,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(service_id,language));`);
}
async function resource(db: Pool | PoolClient, kind: string, id: string) {
  const row = (
    await db.query(
      kind === 'expert'
        ? 'SELECT id,account_id,profile AS source FROM scholars WHERE id=$1'
        : 'SELECT o.id,s.account_id,o.details AS source FROM scholar_offerings o JOIN scholars s ON s.id=o.scholar_id WHERE o.id=$1',
      [id],
    )
  ).rows[0];
  if (!row) throw new ServiceError(404, 'NOT_FOUND');
  return {
    ...row,
    fields: textFields(row.source, kind),
    hash: sourceHash(textFields(row.source, kind)),
    source_language: row.source.source_language ?? 'und',
  };
}
async function variants(
  db: Pool | PoolClient,
  kind: string,
  id: string,
  source: Record<string, unknown>,
) {
  const fields = textFields(source, kind),
    hash = sourceHash(fields),
    table = kind === 'expert' ? 'expert_translations' : 'service_translations',
    column = kind === 'expert' ? 'expert_id' : 'service_id';
  const rows = (
    await db.query(
      `SELECT language,published_fields FROM ${table} WHERE ${column}=$1 AND published_source_hash=$2 AND published_fields IS NOT NULL`,
      [id, hash],
    )
  ).rows;
  const all: Record<string, Record<string, string>> = {};
  if (typeof source.source_language === 'string' && source.source_language !== 'und')
    all[source.source_language] = fields;
  for (const row of rows) all[row.language] = row.published_fields;
  return {
    source: fields,
    source_language: typeof source.source_language === 'string' ? source.source_language : 'und',
    translations: all,
  };
}
export async function translatedFields(
  db: Pool,
  kind: string,
  id: string,
  source: Record<string, unknown>,
  locale: string,
) {
  if (process.env.DISCOVERY_ENABLED !== '1') return source;
  await internalCall('taxonomy-service', '/api/v2/languages/' + locale);
  const all = await variants(db, kind, id, source);
  return {
    ...source,
    ...(all.translations[locale] ?? all.translations.en ?? all.source),
    content_language: all.translations[locale]
      ? locale
      : all.translations.en
        ? 'en'
        : all.source_language,
  };
}
type Taxon = { id: string; kind: string; label: Record<string, string>; code?: string };
export async function publicProjection(
  pool: Pool,
  input: { offset?: number; codes?: string[]; locale?: string },
) {
  const rows = (
    await pool.query(
      "SELECT id,public_id,slug,profile,valid_until::text FROM scholars WHERE status='APPROVED' AND (valid_until IS NULL OR valid_until>now()) AND profile->>'visibility'='PUBLIC' AND ($1::text[] IS NULL OR public_id=ANY($1)) ORDER BY id LIMIT 100 OFFSET $2",
      [input.codes ?? null, input.offset ?? 0],
    )
  ).rows;
  const active = await internalCall<string[]>('identity-service', '/internal/active-accounts', '', {
    codes: rows.map((r) => r.public_id),
  });
  const taxons = await internalCall<Taxon[]>('taxonomy-service', '/api/v2/taxonomy');
  const languages = await internalCall<{ id: string; code: string }[]>(
    'taxonomy-service',
    '/api/v2/languages',
  );
  const allowed = new Set(languages.map((l) => l.code));
  const filter = (value: Awaited<ReturnType<typeof variants>>) => ({
    ...value,
    translations: Object.fromEntries(
      Object.entries(value.translations).filter(([key]) => allowed.has(key)),
    ),
  });
  const result = [];
  for (const row of rows.filter((r) => active.includes(r.public_id))) {
    const specialtyIds = (
      await pool.query(
        "SELECT specialty_id FROM scholar_specialties WHERE scholar_id=$1 AND status='APPROVED'",
        [row.id],
      )
    ).rows.map((s) => s.specialty_id);
    const specialties = taxons.filter((t) => t.kind === 'specialty' && specialtyIds.includes(t.id));
    if (!specialties.length) continue;
    const offerings = (
      await pool.query(
        "SELECT id,details FROM scholar_offerings WHERE scholar_id=$1 AND status='PUBLISHED'",
        [row.id],
      )
    ).rows.filter(
      (o) =>
        specialties.some((s) => s.id === o.details.specialty_id) &&
        (!o.details.category_id ||
          taxons.some((t) => t.id === o.details.category_id && t.kind === 'category')),
    );
    const localized = filter(await variants(pool, 'expert', row.id, row.profile)),
      locale = input.locale ?? 'en';
    const profile = localized.translations[locale] ?? localized.translations.en ?? localized.source;
    const services = [];
    for (const offering of offerings) {
      const translated = filter(await variants(pool, 'service', offering.id, offering.details));
      services.push({
        id: offering.id,
        kind: offering.details.kind,
        duration_minutes: offering.details.duration_minutes,
        price_minor: offering.details.price_minor,
        currency: offering.details.currency,
        booking_required: offering.details.booking_required,
        specialty_id: offering.details.specialty_id,
        fields: translated.translations[locale] ?? translated.translations.en ?? translated.source,
        ...translated,
      });
    }
    result.push({
      code: row.public_id,
      slug: row.slug,
      profile,
      source: localized.source,
      source_language: localized.source_language,
      translations: localized.translations,
      specialties,
      languages: (row.profile.languages as { id: string; level: string }[]).flatMap((l) => {
        const item = languages.find((x) => x.id === l.id);
        return item ? [{ code: item.code, level: l.level }] : [];
      }),
      services,
      years: row.profile.years,
      valid_until: row.valid_until,
    });
  }
  return { items: result, next_offset: rows.length === 100 ? (input.offset ?? 0) + 100 : null };
}
export function discoveryRouter(pool: Pool) {
  const router = internalRouter('128kb');
  router.get(
    '/internal/discovery/projection',
    endpoint(async (req, res) => {
      const input = z
        .object({ offset: z.coerce.number().int().min(0).max(100000).default(0) })
        .strict()
        .parse(req.query);
      res.json({ data: await publicProjection(pool, input) });
    }),
  );
  router.post(
    '/internal/discovery/hydrate',
    endpoint(async (req, res) => {
      const input = z
        .object({ codes: z.array(code).max(100), locale: language.default('en') })
        .strict()
        .parse(req.body);
      res.json({ data: await publicProjection(pool, input) });
    }),
  );
  router.get(
    '/api/v2/experts/translations',
    endpoint(async (req, res) => {
      const user = await principal(req),
        q = z
          .object({ kind: z.enum(['expert', 'service']), id: z.string().uuid() })
          .strict()
          .parse(req.query),
        source = await resource(pool, q.kind, q.id);
      if (source.account_id !== user.id) await requirePermission(req, 'translation.manage');
      const table = q.kind === 'expert' ? 'expert_translations' : 'service_translations',
        column = q.kind === 'expert' ? 'expert_id' : 'service_id';
      res.json({
        data: {
          source: source.fields,
          source_hash: source.hash,
          source_language: source.source_language,
          translations: (
            await pool.query(`SELECT * FROM ${table} WHERE ${column}=$1 ORDER BY language`, [q.id])
          ).rows,
        },
      });
    }),
  );
  router.post(
    '/api/v2/experts/translations',
    endpoint(async (req, res) => {
      const user = await principal(req),
        input = z
          .object({
            kind: z.enum(['expert', 'service']),
            id: z.string().uuid(),
            language,
            fields: z.record(z.string(), z.string().trim().max(12000)),
            source_hash: z.string().regex(/^[a-f0-9]{64}$/),
            revision: z.number().int().nonnegative(),
          })
          .strict()
          .parse(req.body);
      await internalCall('taxonomy-service', '/api/v2/languages/' + input.language);
      const source = await resource(pool, input.kind, input.id);
      if (source.account_id !== user.id) await requirePermission(req, 'translation.manage');
      const expected = input.kind === 'expert' ? expertTextFields : serviceTextFields;
      if (
        Object.keys(input.fields).length !== expected.length ||
        expected.some((key) => typeof input.fields[key] !== 'string') ||
        Object.keys(input.fields).some((key) => !expected.includes(key as never))
      )
        throw new ServiceError(400, 'INVALID_INPUT');
      if (
        !(input.fields.title ?? '').trim() ||
        (input.kind === 'expert' && !(input.fields.display_name ?? '').trim())
      )
        throw new ServiceError(400, 'INVALID_INPUT');
      await transaction(pool, async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,10010))', [input.id]);
        const fresh = await resource(db, input.kind, input.id);
        if (fresh.hash !== input.source_hash) throw new ServiceError(409, 'STALE_SOURCE');
        const table = input.kind === 'expert' ? 'expert_translations' : 'service_translations',
          column = input.kind === 'expert' ? 'expert_id' : 'service_id';
        const old = (
          await db.query(
            `SELECT revision FROM ${table} WHERE ${column}=$1 AND language=$2 FOR UPDATE`,
            [input.id, input.language],
          )
        ).rows[0];
        if ((old?.revision ?? 0) !== input.revision) throw new ServiceError(409, 'CONFLICT');
        await db.query(
          `INSERT INTO ${table}(${column},language,fields,source_hash,editor_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(${column},language) DO UPDATE SET fields=$3,source_hash=$4,status='DRAFT',revision=${table}.revision+1,editor_id=$5,reviewer_id=NULL,updated_at=now()`,
          [input.id, input.language, input.fields, input.source_hash, user.id],
        );
        await db.query(
          "INSERT INTO scholar_audit(actor_id,scholar_id,target_id,action) VALUES($1,$2,$3,'translation.draft')",
          [
            user.id,
            input.kind === 'expert'
              ? input.id
              : (await db.query('SELECT scholar_id FROM scholar_offerings WHERE id=$1', [input.id]))
                  .rows[0].scholar_id,
            input.id + ':' + input.language,
          ],
        );
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.post(
    '/api/v2/experts/translations/review',
    endpoint(async (req, res) => {
      const actor = await requirePermission(req, 'translation.review'),
        input = z
          .object({
            kind: z.enum(['expert', 'service']),
            id: z.string().uuid(),
            language,
            status: z.enum(['HUMAN_REVIEWED', 'APPROVED']),
            revision: z.number().int().positive(),
          })
          .strict()
          .parse(req.body);
      await internalCall('taxonomy-service', '/api/v2/languages/' + input.language);
      await transaction(pool, async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,10010))', [input.id]);
        const source = await resource(db, input.kind, input.id),
          table = input.kind === 'expert' ? 'expert_translations' : 'service_translations',
          column = input.kind === 'expert' ? 'expert_id' : 'service_id';
        const old = (
          await db.query(`SELECT * FROM ${table} WHERE ${column}=$1 AND language=$2 FOR UPDATE`, [
            input.id,
            input.language,
          ])
        ).rows[0];
        if (!old) throw new ServiceError(404, 'NOT_FOUND');
        if (old.source_hash !== source.hash) throw new ServiceError(409, 'STALE_SOURCE');
        if (
          old.revision !== input.revision ||
          (input.status === 'APPROVED'
            ? old.status !== 'HUMAN_REVIEWED'
            : !['DRAFT', 'AI_TRANSLATED'].includes(old.status))
        )
          throw new ServiceError(409, 'CONFLICT');
        await db.query(
          `UPDATE ${table} SET status=$3,revision=revision+1,reviewer_id=$4,published_fields=CASE WHEN $3='APPROVED' THEN fields ELSE published_fields END,published_source_hash=CASE WHEN $3='APPROVED' THEN source_hash ELSE published_source_hash END WHERE ${column}=$1 AND language=$2`,
          [input.id, input.language, input.status, actor.id],
        );
        await db.query(
          'INSERT INTO scholar_audit(actor_id,scholar_id,target_id,action) VALUES($1,$2,$3,$4)',
          [
            actor.id,
            input.kind === 'expert'
              ? input.id
              : (await db.query('SELECT scholar_id FROM scholar_offerings WHERE id=$1', [input.id]))
                  .rows[0].scholar_id,
            input.id + ':' + input.language,
            'translation.' + input.status,
          ],
        );
      });
      res.json({ data: { ok: true } });
    }),
  );
  return router;
}
