import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Pool } from 'pg';
import {
  internalRouter,
  endpoint,
  requirePermission,
  transaction,
  ServiceError,
} from '@vianoor/service-runtime';
const entrySchema = z
  .object({
    kind: z.enum(['specialty', 'category', 'language']),
    label: z
      .object({ fa: z.string().trim().min(1).max(120), en: z.string().trim().min(1).max(120) })
      .strict(),
    parent_id: z.string().uuid().nullable(),
    active: z.boolean(),
    position: z.number().int().min(0).max(10000),
    icon: z
      .string()
      .regex(/^[a-z0-9-]*$/)
      .max(60),
    image_id: z.string().uuid().nullable(),
  })
  .strict();
export async function initializeTaxonomy(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS taxonomy_entries(id uuid PRIMARY KEY,kind text NOT NULL,label jsonb NOT NULL,parent_id uuid REFERENCES taxonomy_entries(id),active boolean NOT NULL,position int NOT NULL,icon text NOT NULL,image_id uuid,revision int NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS taxonomy_audit(id bigserial PRIMARY KEY,actor_id uuid NOT NULL,target_id uuid NOT NULL,action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());`);
  await transaction(pool, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(8001)');
    if ((await db.query("SELECT 1 FROM taxonomy_entries WHERE kind='language' LIMIT 1")).rowCount)
      return;
    for (const [fa, en] of [
      ['فارسی', 'Persian'],
      ['عربی', 'Arabic'],
      ['انگلیسی', 'English'],
      ['ترکی', 'Turkish'],
      ['اردو', 'Urdu'],
    ])
      await db.query(
        "INSERT INTO taxonomy_entries(id,kind,label,active,position,icon) VALUES($1,'language',$2,true,0,'')",
        [randomUUID(), { fa, en }],
      );
  });
}
export function taxonomyRouter(pool: Pool) {
  const router = internalRouter();
  router.get(
    '/api/v2/taxonomy',
    endpoint(async (req, res) => {
      const admin = req.query.admin === '1';
      if (admin) await requirePermission(req, 'specialty.manage');
      res.json({
        data: (
          await pool.query(
            'WITH RECURSIVE hidden AS (SELECT id FROM taxonomy_entries WHERE NOT active UNION SELECT t.id FROM taxonomy_entries t JOIN hidden h ON t.parent_id=h.id) SELECT * FROM taxonomy_entries WHERE $1 OR id NOT IN (SELECT id FROM hidden) ORDER BY position,id',
            [admin],
          )
        ).rows,
      });
    }),
  );
  router.post(
    '/internal/taxonomy/validate',
    endpoint(async (req, res) => {
      const input = z
        .object({
          specialties: z.array(z.string().uuid()).max(30),
          languages: z.array(z.string().uuid()).max(30),
          categories: z.array(z.string().uuid()).max(5).default([]),
        })
        .strict()
        .parse(req.body);
      for (const [kind, ids] of [
        ['specialty', input.specialties],
        ['language', input.languages],
        ['category', input.categories],
      ] as const) {
        const rows = (
          await pool.query(
            'WITH RECURSIVE ancestors AS (SELECT id,parent_id,active FROM taxonomy_entries WHERE id=ANY($1::uuid[]) AND kind=$2 UNION SELECT p.id,p.parent_id,p.active FROM taxonomy_entries p JOIN ancestors a ON p.id=a.parent_id) SELECT * FROM ancestors',
            [ids, kind],
          )
        ).rows;
        if (ids.some((id) => !rows.some((r) => r.id === id)) || rows.some((r) => !r.active))
          throw new ServiceError(400, 'INVALID_TAXONOMY');
      }
      res.json({ data: { ok: true } });
    }),
  );
  router.post(
    '/api/v2/taxonomy',
    endpoint(async (req, res) => {
      const user = await requirePermission(req, 'specialty.manage');
      const input = entrySchema.parse(req.body);
      const id = randomUUID();
      await transaction(pool, async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(8001)');
        if (
          input.parent_id &&
          !(
            await db.query('SELECT 1 FROM taxonomy_entries WHERE id=$1 AND kind=$2', [
              input.parent_id,
              input.kind,
            ])
          ).rowCount
        )
          throw new ServiceError(400, 'INVALID_PARENT');
        if (input.kind === 'language' && input.parent_id)
          throw new ServiceError(400, 'INVALID_PARENT');
        await db.query(
          'INSERT INTO taxonomy_entries(id,kind,label,parent_id,active,position,icon,image_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            id,
            input.kind,
            input.label,
            input.parent_id,
            input.active,
            input.position,
            input.icon,
            input.image_id,
          ],
        );
        await db.query(
          "INSERT INTO taxonomy_audit(actor_id,target_id,action) VALUES($1,$2,'created')",
          [user.id, id],
        );
      });
      res.status(201).json({ data: { id } });
    }),
  );
  router.put(
    '/api/v2/taxonomy/:id',
    endpoint(async (req, res) => {
      const user = await requirePermission(req, 'specialty.manage');
      const id = z.string().uuid().parse(req.params.id);
      const input = entrySchema
        .extend({ revision: z.number().int().nonnegative() })
        .parse(req.body);
      await transaction(pool, async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(8001)');
        const old = (await db.query('SELECT * FROM taxonomy_entries WHERE id=$1', [id])).rows[0];
        if (!old) throw new ServiceError(404, 'NOT_FOUND');
        if (old.kind !== input.kind || old.revision !== input.revision)
          throw new ServiceError(409, 'CONFLICT');
        if (input.parent_id) {
          if (
            input.kind === 'language' ||
            !(
              await db.query('SELECT 1 FROM taxonomy_entries WHERE id=$1 AND kind=$2', [
                input.parent_id,
                input.kind,
              ])
            ).rowCount
          )
            throw new ServiceError(400, 'INVALID_PARENT');
          const cycle = await db.query(
            'WITH RECURSIVE ancestors AS (SELECT id,parent_id FROM taxonomy_entries WHERE id=$1 UNION SELECT p.id,p.parent_id FROM taxonomy_entries p JOIN ancestors a ON p.id=a.parent_id) SELECT 1 FROM ancestors WHERE id=$2',
            [input.parent_id, id],
          );
          if (cycle.rowCount) throw new ServiceError(400, 'INVALID_PARENT');
        }
        await db.query(
          'UPDATE taxonomy_entries SET label=$2,parent_id=$3,active=$4,position=$5,icon=$6,image_id=$7,revision=revision+1 WHERE id=$1',
          [
            id,
            input.label,
            input.parent_id,
            input.active,
            input.position,
            input.icon,
            input.image_id,
          ],
        );
        await db.query(
          "INSERT INTO taxonomy_audit(actor_id,target_id,action) VALUES($1,$2,'updated')",
          [user.id, id],
        );
      });
      res.json({ data: { id } });
    }),
  );
  return router;
}
