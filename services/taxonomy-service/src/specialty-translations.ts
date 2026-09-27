import type { Pool } from 'pg';
import { z } from 'zod';
import {
  internalRouter,
  endpoint,
  requirePermission,
  transaction,
  ServiceError,
} from '@vianoor/service-runtime';
import { languageCode } from './localization.js';
export function specialtyTranslationsRouter(pool: Pool) {
  const router = internalRouter();
  router.get(
    '/api/v2/localization/specialties',
    endpoint(async (req, res) => {
      await requirePermission(req, 'translation.manage');
      const q = z
        .object({ id: z.string().uuid(), language: languageCode })
        .strict()
        .parse(req.query);
      const source = (
        await pool.query(
          "SELECT * FROM taxonomy_entries WHERE id=$1 AND kind IN ('specialty','category')",
          [q.id],
        )
      ).rows[0];
      if (!source) throw new ServiceError(404, 'NOT_FOUND');
      res.json({
        data: {
          source,
          translation:
            (
              await pool.query(
                'SELECT * FROM specialty_translations WHERE entry_id=$1 AND language=$2',
                [q.id, q.language],
              )
            ).rows[0] ?? null,
        },
      });
    }),
  );
  router.post(
    '/api/v2/localization/specialties',
    endpoint(async (req, res) => {
      const actor = await requirePermission(req, 'translation.manage'),
        input = z
          .object({
            id: z.string().uuid(),
            language: languageCode,
            value: z.string().trim().min(1).max(120),
            source_revision: z.number().int().nonnegative(),
            revision: z.number().int().nonnegative(),
          })
          .strict()
          .parse(req.body);
      if (input.language === 'en') throw new ServiceError(400, 'EDIT_SOURCE_INSTEAD');
      await transaction(pool, async (db) => {
        const source = (
          await db.query(
            "SELECT * FROM taxonomy_entries WHERE id=$1 AND kind IN ('specialty','category') FOR UPDATE",
            [input.id],
          )
        ).rows[0];
        if (!source) throw new ServiceError(404, 'NOT_FOUND');
        if (source.revision !== input.source_revision) throw new ServiceError(409, 'STALE_SOURCE');
        if (
          !(
            await db.query("SELECT 1 FROM languages WHERE code=$1 AND status='ACTIVE'", [
              input.language,
            ])
          ).rowCount
        )
          throw new ServiceError(404, 'LANGUAGE_UNAVAILABLE');
        const old = (
          await db.query(
            'SELECT revision FROM specialty_translations WHERE entry_id=$1 AND language=$2',
            [input.id, input.language],
          )
        ).rows[0];
        if ((old?.revision ?? 0) !== input.revision) throw new ServiceError(409, 'CONFLICT');
        await db.query(
          "INSERT INTO specialty_translations(entry_id,language,value,source_revision,editor_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(entry_id,language) DO UPDATE SET value=$3,source_revision=$4,editor_id=$5,reviewer_id=NULL,status='DRAFT',revision=specialty_translations.revision+1",
          [input.id, input.language, input.value, input.source_revision, actor.id],
        );
        await db.query(
          "INSERT INTO localization_audit(actor_id,target,action) VALUES($1,$2,'specialty.draft')",
          [actor.id, input.id],
        );
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.post(
    '/api/v2/localization/specialties/review',
    endpoint(async (req, res) => {
      const actor = await requirePermission(req, 'translation.review'),
        input = z
          .object({
            id: z.string().uuid(),
            language: languageCode,
            status: z.enum(['HUMAN_REVIEWED', 'APPROVED']),
            revision: z.number().int().positive(),
          })
          .strict()
          .parse(req.body);
      await transaction(pool, async (db) => {
        const source = (
          await db.query('SELECT * FROM taxonomy_entries WHERE id=$1 FOR UPDATE', [input.id])
        ).rows[0];
        const old = (
          await db.query(
            'SELECT * FROM specialty_translations WHERE entry_id=$1 AND language=$2 FOR UPDATE',
            [input.id, input.language],
          )
        ).rows[0];
        if (!source || !old) throw new ServiceError(404, 'NOT_FOUND');
        if (old.source_revision !== source.revision) throw new ServiceError(409, 'STALE_SOURCE');
        if (
          old.revision !== input.revision ||
          (input.status === 'APPROVED'
            ? old.status !== 'HUMAN_REVIEWED'
            : !['DRAFT', 'AI_TRANSLATED'].includes(old.status))
        )
          throw new ServiceError(409, 'CONFLICT');
        await db.query(
          "UPDATE specialty_translations SET status=$3,revision=revision+1,reviewer_id=$4,published_value=CASE WHEN $3='APPROVED' THEN value ELSE published_value END,published_source_revision=CASE WHEN $3='APPROVED' THEN source_revision ELSE published_source_revision END WHERE entry_id=$1 AND language=$2",
          [input.id, input.language, input.status, actor.id],
        );
        await db.query('INSERT INTO localization_audit(actor_id,target,action) VALUES($1,$2,$3)', [
          actor.id,
          input.id,
          'specialty.' + input.status,
        ]);
      });
      res.json({ data: { ok: true } });
    }),
  );
  return router;
}
export async function translateTaxons(
  pool: Pool,
  rows: { id: string; revision: number; label: Record<string, string> }[],
) {
  if (process.env.DISCOVERY_ENABLED !== '1') return rows;
  const translations = (
    await pool.query(
      "SELECT t.* FROM specialty_translations t JOIN languages l ON l.code=t.language AND l.status='ACTIVE' WHERE entry_id=ANY($1::uuid[]) AND published_value IS NOT NULL",
      [rows.map((r) => r.id)],
    )
  ).rows;
  return rows.map((row) => ({
    ...row,
    label: {
      ...row.label,
      ...Object.fromEntries(
        translations
          .filter((t) => t.entry_id === row.id && t.published_source_revision === row.revision)
          .map((t) => [t.language, t.published_value]),
      ),
    },
  }));
}
