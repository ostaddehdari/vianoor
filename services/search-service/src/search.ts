import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  internalRouter,
  endpoint,
  requirePermission,
  internalCall,
  ServiceError,
  transaction,
} from '@vianoor/service-runtime';
export function normalize(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[\u200c\u200d]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export const querySchema = z
  .object({
    q: z.string().trim().max(300).default(''),
    language: z
      .string()
      .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
      .max(35)
      .default('en'),
    spoken_language: z
      .string()
      .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
      .max(35)
      .optional(),
    specialty: z.string().uuid().optional(),
    offset: z.coerce.number().int().min(0).max(3000).default(0),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
type Query = z.infer<typeof querySchema>;
type Expert = {
  code: string;
  slug: string;
  profile: Record<string, string>;
  source: Record<string, string>;
  translations: Record<string, Record<string, string>>;
  specialties: { id: string; label: Record<string, string> }[];
  languages: { code: string; level: string }[];
  services: {
    id: string;
    fields: Record<string, string>;
    source: Record<string, string>;
    translations: Record<string, Record<string, string>>;
    booking_required: boolean;
    price_minor: number;
    currency: string;
    duration_minutes: number | null;
    specialty_id: string;
    category_id: string | null;
    kind: string;
  }[];
};
type Cache = {
  get(key: string): Promise<string | null>;
  setEx(key: string, seconds: number, value: string): Promise<unknown>;
};
export const indexPrefix = process.env.SEARCH_INDEX_PREFIX ?? 'expert-search';
if (!/^[a-z][a-z0-9-]{2,50}$/.test(indexPrefix)) throw Error('Invalid search index prefix');
export const alias = indexPrefix + '-current';
export const languageAnalyzer = (code: string) =>
  (
    ({
      ar: 'arabic',
      hy: 'armenian',
      eu: 'basque',
      bn: 'bengali',
      bg: 'bulgarian',
      ca: 'catalan',
      cs: 'czech',
      da: 'danish',
      nl: 'dutch',
      en: 'english',
      et: 'estonian',
      fi: 'finnish',
      fr: 'french',
      gl: 'galician',
      de: 'german',
      el: 'greek',
      hi: 'hindi',
      hu: 'hungarian',
      id: 'indonesian',
      ga: 'irish',
      it: 'italian',
      lv: 'latvian',
      lt: 'lithuanian',
      no: 'norwegian',
      nb: 'norwegian',
      nn: 'norwegian',
      fa: 'persian',
      pt: 'portuguese',
      ro: 'romanian',
      ru: 'russian',
      es: 'spanish',
      sv: 'swedish',
      th: 'thai',
      tr: 'turkish',
      zh: 'cjk',
      ja: 'cjk',
      ko: 'cjk',
    }) as Record<string, string>
  )[code.split('-')[0]!] ?? 'standard';
export async function opensearch(path: string, method = 'GET', body?: unknown) {
  const base = process.env.OPENSEARCH_URL;
  if (!base) throw new ServiceError(503, 'SEARCH_UNAVAILABLE');
  const result = await fetch(new URL(path, base), {
    method,
    signal: AbortSignal.timeout(20000),
    redirect: 'error',
    headers: {
      'content-type': path.includes('_bulk') ? 'application/x-ndjson' : 'application/json',
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  const value = await result.json();
  if (!result.ok) throw new ServiceError(503, 'SEARCH_UNAVAILABLE');
  return value;
}
export async function initializeSearch(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS search_synonyms(id uuid PRIMARY KEY,source text NOT NULL,target text NOT NULL,source_language text NOT NULL,target_language text NOT NULL,active boolean NOT NULL DEFAULT true,revision int NOT NULL DEFAULT 1,UNIQUE(source,target,source_language,target_language));
CREATE TABLE IF NOT EXISTS search_state(id int PRIMARY KEY CHECK(id=1),generation bigint NOT NULL DEFAULT 1,indexed_generation bigint NOT NULL DEFAULT 0,index_name text,updated_at timestamptz,error_code text);
INSERT INTO search_state(id) VALUES(1) ON CONFLICT DO NOTHING;
ALTER TABLE search_state ADD COLUMN IF NOT EXISTS schema_version int NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS search_audit(id bigserial PRIMARY KEY,actor_id uuid NOT NULL,target_id uuid NOT NULL,action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());`);
}
export function indexDocument(item: Expert) {
  const grouped: Record<string, string[]> = {};
  const add = (lang: string, values: Record<string, string>) => {
    (grouped[lang] ??= []).push(...Object.values(values));
  };
  for (const [lang, fields] of Object.entries(item.translations)) add(lang, fields);
  for (const specialty of item.specialties)
    for (const [lang, value] of Object.entries(specialty.label)) add(lang, { value });
  for (const service of item.services) {
    for (const [lang, fields] of Object.entries(service.translations)) add(lang, fields);
  }
  return {
    code: item.code,
    spoken: item.languages.map((l) => l.code),
    specialties: item.specialties.map((s) => s.id),
    text_fa: (grouped.fa ?? []).join(' '),
    text_ar: (grouped.ar ?? []).join(' '),
    text_en: (grouped.en ?? []).join(' '),
    localized: Object.fromEntries(
      Object.entries(grouped).map(([language, text]) => [language, text.join(' ')]),
    ),
    all_text: normalize(
      [
        ...Object.values(grouped).flat(),
        ...Object.values(item.source),
        ...item.services.flatMap((s) => Object.values(s.source)),
      ].join(' '),
    ),
  };
}
export async function rebuild(pool: Pool) {
  const db = await pool.connect();
  let locked = false;
  try {
    locked = (await db.query('SELECT pg_try_advisory_lock(10026) AS locked')).rows[0].locked;
    if (!locked) return false;
    const state = (await db.query('SELECT * FROM search_state WHERE id=1')).rows[0];
    if (
      state.generation === state.indexed_generation &&
      state.index_name &&
      state.schema_version === 2
    )
      return true;
    let published = false;
    const name = indexPrefix + '-' + Date.now() + '-' + randomUUID().slice(0, 8);
    const languages = await internalCall<{ code: string }[]>(
      'taxonomy-service',
      '/api/v2/languages',
    );
    await opensearch('/' + name, 'PUT', {
      settings: { number_of_shards: 1, number_of_replicas: 0 },
      mappings: {
        dynamic: 'strict',
        properties: {
          localized: {
            type: 'object',
            dynamic: false,
            properties: Object.fromEntries(
              languages.map((l) => [l.code, { type: 'text', analyzer: languageAnalyzer(l.code) }]),
            ),
          },
          code: { type: 'keyword' },
          spoken: { type: 'keyword' },
          specialties: { type: 'keyword' },
          text_fa: { type: 'text', analyzer: 'persian' },
          text_ar: { type: 'text', analyzer: 'arabic' },
          text_en: { type: 'text', analyzer: 'english' },
          all_text: { type: 'text', analyzer: 'standard' },
        },
      },
    });
    try {
      let offset: number | null = 0,
        count = 0;
      while (offset !== null) {
        const page: { items: Expert[]; next_offset: number | null } = await internalCall(
          'scholar-service',
          '/internal/discovery/projection?offset=' + offset,
        );
        count += page.items.length;
        if (count > 3000 || offset > 10000) throw new Error('INDEX_CAPACITY');
        if (page.items.length) {
          const body =
            page.items
              .flatMap((item) => [
                JSON.stringify({ index: { _id: item.code } }),
                JSON.stringify(indexDocument(item)),
              ])
              .join('\n') + '\n';
          const result = await opensearch('/' + name + '/_bulk', 'POST', body);
          if (result.errors) throw new Error('INDEX_WRITE_FAILED');
        }
        offset = page.next_offset;
      }
      await opensearch('/' + name + '/_refresh', 'POST');
      await opensearch('/_aliases', 'POST', {
        actions: [
          { remove: { index: indexPrefix + '-*', alias, must_exist: false } },
          { add: { index: name, alias } },
        ],
      });
      published = true;
      await db.query(
        'UPDATE search_state SET indexed_generation=$1,index_name=$2,schema_version=2,updated_at=now(),error_code=NULL WHERE id=1',
        [state.generation, name],
      );
      if (state.index_name) await opensearch('/' + state.index_name, 'DELETE').catch(() => {});
      return true;
    } catch (error) {
      if (!published) await opensearch('/' + name, 'DELETE').catch(() => {});
      throw error;
    }
  } catch {
    await db.query("UPDATE search_state SET error_code='INDEX_REBUILD_FAILED' WHERE id=1");
    return false;
  } finally {
    if (locked) await db.query('SELECT pg_advisory_unlock(10026)');
    db.release();
  }
}
export async function search(pool: Pool, cache: Cache, input: Query) {
  await internalCall('taxonomy-service', '/api/v2/languages/' + input.language);
  if (input.spoken_language)
    await internalCall('taxonomy-service', '/api/v2/languages/' + input.spoken_language);
  const state = (
    await pool.query('SELECT indexed_generation,index_name FROM search_state WHERE id=1')
  ).rows[0];
  if (!state?.index_name) throw new ServiceError(503, 'SEARCH_INDEX_PENDING');
  const synonyms = (
    await pool.query(
      'SELECT source,target FROM search_synonyms WHERE active AND (source_language=$1 OR target_language=$1) ORDER BY id LIMIT 5000',
      [input.language],
    )
  ).rows;
  const normalized = normalize(input.q),
    terms = new Set([normalized]);
  for (const entry of synonyms) {
    if (normalized.includes(normalize(entry.source)))
      terms.add(normalized.replace(normalize(entry.source), normalize(entry.target)));
    if (normalized.includes(normalize(entry.target)))
      terms.add(normalized.replace(normalize(entry.target), normalize(entry.source)));
    if (terms.size >= 8) break;
  }
  const key =
    'discovery:' +
    state.indexed_generation +
    ':' +
    createHash('sha256').update(JSON.stringify(input)).digest('hex');
  let codes: string[] | undefined;
  try {
    const cached = await cache.get(key);
    if (cached) codes = JSON.parse(cached);
  } catch {
    /* Cache never gates correctness. */
  }
  if (!codes) {
    const filter = [];
    if (input.spoken_language) filter.push({ term: { spoken: input.spoken_language } });
    if (input.specialty) filter.push({ term: { specialties: input.specialty } });
    const must = normalized
      ? [
          {
            bool: {
              should: [...terms].map((q) => ({
                multi_match: {
                  query: q,
                  fields: [
                    'localized.' + input.language + '^4',
                    'text_' +
                      (['fa', 'ar', 'en'].includes(input.language) ? input.language : 'en') +
                      '^3',
                    'text_fa',
                    'text_ar',
                    'text_en',
                    'all_text',
                  ],
                  type: 'best_fields',
                  operator: 'and',
                },
              })),
              minimum_should_match: 1,
            },
          },
        ]
      : [];
    const result = await opensearch('/' + alias + '/_search', 'POST', {
      size: input.limit + 1,
      from: input.offset,
      track_total_hits: false,
      _source: false,
      query: { bool: { filter, must } },
      sort: normalized ? ['_score', { code: 'asc' }] : [{ code: 'asc' }],
    });
    codes = result.hits.hits.map((hit: { _id: string }) => hit._id);
    await cache.setEx(key, 30, JSON.stringify(codes)).catch(() => {});
  }
  // The owner rechecks current publication, account status, specialties and translations on every read.
  const fresh = await internalCall<{ items: Expert[] }>(
    'scholar-service',
    '/internal/discovery/hydrate',
    '',
    { codes, locale: input.language },
  );
  const items = codes!
    .slice(0, input.limit)
    .flatMap((code) => {
      const item = fresh.items.find((i) => i.code === code);
      return item &&
        (!input.spoken_language || item.languages.some((l) => l.code === input.spoken_language)) &&
        (!input.specialty || item.specialties.some((s) => s.id === input.specialty))
        ? [item]
        : [];
    })
    .slice(0, input.limit);
  return { items, next_offset: codes!.length > input.limit ? input.offset + input.limit : null };
}
export function searchRouter(pool: Pool, cache: Cache) {
  const router = internalRouter();
  router.get(
    '/api/v2/search/experts',
    endpoint(async (req, res) =>
      res.json({ data: await search(pool, cache, querySchema.parse(req.query)) }),
    ),
  );
  router.get(
    '/api/v2/search/status',
    endpoint(async (req, res) => {
      await requirePermission(req, 'search.manage');
      res.json({ data: (await pool.query('SELECT * FROM search_state WHERE id=1')).rows[0] });
    }),
  );
  router.post(
    '/api/v2/search/rebuild',
    endpoint(async (req, res) => {
      await requirePermission(req, 'search.manage');
      await pool.query('UPDATE search_state SET generation=generation+1 WHERE id=1');
      res.status(202).json({ data: { queued: true } });
    }),
  );
  router.get(
    '/api/v2/search/synonyms',
    endpoint(async (req, res) => {
      await requirePermission(req, 'search.manage');
      res.json({
        data: (
          await pool.query(
            'SELECT * FROM search_synonyms ORDER BY source_language,source LIMIT 5000',
          )
        ).rows,
      });
    }),
  );
  const synonym = z
    .object({
      source: z.string().trim().min(1).max(120),
      target: z.string().trim().min(1).max(120),
      source_language: z.string().max(35),
      target_language: z.string().max(35),
      active: z.boolean(),
    })
    .strict();
  router.post(
    '/api/v2/search/synonyms',
    endpoint(async (req, res) => {
      const actor = await requirePermission(req, 'search.manage'),
        input = synonym.parse(req.body),
        id = randomUUID();
      await Promise.all([
        internalCall(
          'taxonomy-service',
          '/api/v2/languages/' + encodeURIComponent(input.source_language),
        ),
        internalCall(
          'taxonomy-service',
          '/api/v2/languages/' + encodeURIComponent(input.target_language),
        ),
      ]);
      await transaction(pool, async (db) => {
        await db.query(
          'INSERT INTO search_synonyms(id,source,target,source_language,target_language,active) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source,target,source_language,target_language) DO UPDATE SET active=$6,revision=search_synonyms.revision+1',
          [
            id,
            input.source,
            input.target,
            input.source_language,
            input.target_language,
            input.active,
          ],
        );
        await db.query('UPDATE search_state SET generation=generation+1 WHERE id=1');
        await db.query(
          "INSERT INTO search_audit(actor_id,target_id,action) VALUES($1,$2,'synonym.saved')",
          [actor.id, id],
        );
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.post(
    '/api/v2/search/synonyms/:id/remove',
    endpoint(async (req, res) => {
      const actor = await requirePermission(req, 'search.manage'),
        id = z.string().uuid().parse(req.params.id);
      await transaction(pool, async (db) => {
        await db.query('DELETE FROM search_synonyms WHERE id=$1', [id]);
        await db.query('UPDATE search_state SET generation=generation+1 WHERE id=1');
        await db.query(
          "INSERT INTO search_audit(actor_id,target_id,action) VALUES($1,$2,'synonym.removed')",
          [actor.id, id],
        );
      });
      res.json({ data: { ok: true } });
    }),
  );
  return router;
}
