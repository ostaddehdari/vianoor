import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Request } from 'express';
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
import {
  professionalSchema,
  documentSchema,
  offeringSchema,
  reviewSchema,
  applicationStatus,
  assertTransition,
  missingProfessional,
  isVerified,
  type Professional,
  type ApplicationStatus,
} from './model.js';

export async function initializeScholars(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS scholars (
    id uuid PRIMARY KEY, account_id uuid UNIQUE NOT NULL, public_id varchar(13) UNIQUE NOT NULL, slug varchar(80) UNIQUE NOT NULL,
    profile jsonb NOT NULL,status text NOT NULL DEFAULT 'DRAFT',revision int NOT NULL DEFAULT 0,valid_until timestamptz,
    submitted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS scholar_specialties(scholar_id uuid REFERENCES scholars(id),specialty_id uuid NOT NULL,status text NOT NULL DEFAULT 'PENDING',reason text NOT NULL DEFAULT '',PRIMARY KEY(scholar_id,specialty_id));
  CREATE TABLE IF NOT EXISTS scholar_documents(id uuid PRIMARY KEY,scholar_id uuid REFERENCES scholars(id),details jsonb NOT NULL,status text NOT NULL DEFAULT 'PENDING',reason text NOT NULL DEFAULT '',deleted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS scholar_decisions(id bigserial PRIMARY KEY,scholar_id uuid REFERENCES scholars(id),actor_id uuid NOT NULL,status text NOT NULL,reason text NOT NULL,internal_note text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS scholar_offerings(id uuid PRIMARY KEY,scholar_id uuid REFERENCES scholars(id),details jsonb NOT NULL,status text NOT NULL DEFAULT 'DRAFT',reason text NOT NULL DEFAULT '',revision int NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS scholar_settings(id int PRIMARY KEY CHECK(id=1),review_services boolean NOT NULL DEFAULT true);
  INSERT INTO scholar_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
  CREATE TABLE IF NOT EXISTS scholar_audit(id bigserial PRIMARY KEY,actor_id uuid NOT NULL,scholar_id uuid NOT NULL,target_id text NOT NULL,action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS scholar_notifications(id uuid PRIMARY KEY,account_id uuid NOT NULL,scholar_id uuid NOT NULL,event text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),read_at timestamptz);
  CREATE INDEX IF NOT EXISTS scholar_status_idx ON scholars(status,submitted_at);
  CREATE INDEX IF NOT EXISTS scholar_documents_owner_idx ON scholar_documents(scholar_id);`);
  await pool.query(`ALTER TABLE scholar_notifications ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
    CREATE TABLE IF NOT EXISTS scholar_reminders(document_id uuid NOT NULL,expires_at date NOT NULL,PRIMARY KEY(document_id,expires_at));`);
}

export async function deliverScholarNotifications(pool: Pool) {
  await transaction(pool, async (db) => {
    const due = (
      await db.query(
        "SELECT d.id,d.scholar_id,d.details->>'expires_at' AS expiry,s.account_id FROM scholar_documents d JOIN scholars s ON s.id=d.scholar_id WHERE d.deleted_at IS NULL AND d.status='APPROVED' AND (d.details->>'expires_at')::date BETWEEN current_date AND current_date+30",
      )
    ).rows;
    for (const doc of due) {
      if (
        (
          await db.query(
            'INSERT INTO scholar_reminders(document_id,expires_at) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING document_id',
            [doc.id, doc.expiry],
          )
        ).rowCount
      )
        await db.query(
          "INSERT INTO scholar_notifications(id,account_id,scholar_id,event) VALUES($1,$2,$3,'DOCUMENT_EXPIRING')",
          [randomUUID(), doc.account_id, doc.scholar_id],
        );
    }
  });
  const pending = (
    await pool.query(
      "SELECT id,account_id,event FROM scholar_notifications WHERE delivered_at IS NULL AND event IN ('SUBMITTED','UNDER_REVIEW','NEEDS_CHANGES','APPROVED','SUSPENDED','REJECTED','DOCUMENTS_REJECTED','SPECIALTIES_APPROVED','SERVICE_PUBLISHED','DOCUMENT_EXPIRING') ORDER BY created_at LIMIT 10",
    )
  ).rows;
  for (const job of pending) {
    await internalCall('identity-service', '/internal/expert-notification', '', job);
    await pool.query('UPDATE scholar_notifications SET delivered_at=now() WHERE id=$1', [job.id]);
  }
}
export function notificationWorker(pool: Pool) {
  let timer: ReturnType<typeof setTimeout> | undefined,
    stopped = false;
  let running: Promise<unknown> = Promise.resolve();
  const tick = () => {
    running = deliverScholarNotifications(pool)
      .catch(() => {})
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, 5000);
      });
  };
  tick();
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await running;
  };
}
type Scholar = {
  id: string;
  account_id: string;
  public_id: string;
  slug: string;
  profile: Professional;
  status: ApplicationStatus;
  revision: number;
  valid_until: string | null;
};
const auth = (req: Request) => req.get('authorization') ?? '';
async function record(
  db: PoolClient,
  actor: string,
  scholar: Scholar,
  event: string,
  target = scholar.id,
) {
  await db.query(
    'INSERT INTO scholar_audit(actor_id,scholar_id,target_id,action) VALUES($1,$2,$3,$4)',
    [actor, scholar.id, target, event],
  );
  await db.query(
    'INSERT INTO scholar_notifications(id,account_id,scholar_id,event) VALUES($1,$2,$3,$4)',
    [randomUUID(), scholar.account_id, scholar.id, event],
  );
}
async function taxonomy(req: Request, profile: Professional) {
  await internalCall('taxonomy-service', '/internal/taxonomy/validate', auth(req), {
    specialties: profile.specialties,
    languages: profile.languages.map((l) => l.id),
  });
}
async function fileReady(req: Request, id: string, kind: 'document' | 'image', owner: string) {
  return internalCall('file-service', '/internal/files/validate', auth(req), { id, kind, owner });
}
async function pinImage(req: Request, id: string | null, owner: string, reference: string) {
  if (!id) return;
  await fileReady(req, id, 'image', owner);
  await internalCall('file-service', '/internal/files/reference', auth(req), {
    id,
    owner,
    reference,
  });
}
export function scholarsRouter(pool: Pool) {
  const router = internalRouter('128kb');
  router.post(
    '/internal/files/released-document',
    endpoint(async (req, res) => {
      const user = await principal(req);
      const input = z
        .object({ id: z.string().uuid(), document_id: z.string().uuid() })
        .strict()
        .parse(req.body);
      if (
        !(
          await pool.query(
            "SELECT 1 FROM scholar_documents d JOIN scholars s ON s.id=d.scholar_id WHERE d.id=$1 AND d.details->>'file_id'=$2 AND d.deleted_at IS NOT NULL AND s.account_id=$3",
            [input.document_id, input.id, user.id],
          )
        ).rowCount
      )
        throw new ServiceError(403, 'FORBIDDEN');
      res.json({ data: { ok: true } });
    }),
  );
  router.post(
    '/internal/files/review-access',
    endpoint(async (req, res) => {
      await requirePermission(req, 'expert.document.review');
      const input = z.object({ id: z.string().uuid() }).strict().parse(req.body);
      if (
        !(
          await pool.query(
            "SELECT 1 FROM scholar_documents d JOIN scholars s ON s.id=d.scholar_id WHERE d.details->>'file_id'=$1 AND d.deleted_at IS NULL AND s.status IN ('SUBMITTED','UNDER_REVIEW','NEEDS_CHANGES','APPROVED','SUSPENDED','REJECTED')",
            [input.id],
          )
        ).rowCount
      )
        throw new ServiceError(403, 'FORBIDDEN');
      res.json({ data: { ok: true } });
    }),
  );
  const load = async (db: Pool | PoolClient, id: string, lock = false): Promise<Scholar> => {
    const row = (
      await db.query(
        'SELECT *,valid_until::text FROM scholars WHERE id=$1' + (lock ? ' FOR UPDATE' : ''),
        [id],
      )
    ).rows[0];
    if (!row) throw new ServiceError(404, 'NOT_FOUND');
    return row;
  };
  const mine = async (req: Request) => {
    const user = await principal(req);
    const row = (
      await pool.query('SELECT *,valid_until::text FROM scholars WHERE account_id=$1', [user.id])
    ).rows[0] as Scholar | undefined;
    return { user, row };
  };
  const documents = async (db: Pool | PoolClient, id: string) =>
    (
      await db.query(
        `SELECT id,details,CASE WHEN details->>'expires_at'<to_char(current_date,'YYYY-MM-DD') THEN 'EXPIRED' ELSE status END AS status,reason FROM scholar_documents WHERE scholar_id=$1 AND deleted_at IS NULL ORDER BY created_at`,
        [id],
      )
    ).rows;
  const detail = async (row: Scholar, admin = false) => {
    const docs = await documents(pool, row.id);
    const missing = missingProfessional(
      row.profile,
      docs.map((d) => ({ status: d.status, expires_at: d.details.expires_at })),
    );
    return {
      ...row,
      verified: isVerified(row.status, row.valid_until),
      missing,
      completion: Math.round(((8 - missing.length) / 8) * 100),
      documents: docs,
      specialties: (
        await pool.query(
          'SELECT specialty_id,status,reason FROM scholar_specialties WHERE scholar_id=$1',
          [row.id],
        )
      ).rows,
      offerings: (
        await pool.query(
          'SELECT * FROM scholar_offerings WHERE scholar_id=$1 ORDER BY created_at',
          [row.id],
        )
      ).rows,
      decisions: (
        await pool.query(
          `SELECT id,status,reason,created_at${admin ? ',internal_note,actor_id' : ''} FROM scholar_decisions WHERE scholar_id=$1 ORDER BY id DESC`,
          [row.id],
        )
      ).rows,
    };
  };
  router.get(
    '/internal/experts/qualification/:code',
    endpoint(async (req, res) => {
      const code = z
        .string()
        .regex(/^[A-Za-z0-9]{13}$/)
        .parse(req.params.code);
      const row = (
        await pool.query('SELECT status,valid_until::text FROM scholars WHERE public_id=$1', [code])
      ).rows[0];
      res.json({ data: { verified: !!row && isVerified(row.status, row.valid_until) } });
    }),
  );
  router.get(
    '/api/v2/experts/me',
    endpoint(async (req, res) => {
      const { row } = await mine(req);
      res.json({ data: row ? await detail(row) : null });
    }),
  );
  router.post(
    '/api/v2/experts/me',
    endpoint(async (req, res) => {
      const { user, row } = await mine(req);
      if (row) throw new ServiceError(409, 'ALREADY_EXISTS');
      const input = professionalSchema.parse(req.body);
      await taxonomy(req, input);
      const id = randomUUID();
      await pinImage(req, input.image_id, user.public_id, 'scholar-image:' + id);
      await transaction(pool, async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(8002)');
        if (
          (
            await db.query('SELECT 1 FROM scholars WHERE slug=$1 OR account_id=$2', [
              input.slug,
              user.id,
            ])
          ).rowCount
        )
          throw new ServiceError(409, 'ALREADY_EXISTS');
        await db.query(
          'INSERT INTO scholars(id,account_id,public_id,slug,profile) VALUES($1,$2,$3,$4,$5)',
          [id, user.id, user.public_id, input.slug, input],
        );
        for (const s of input.specialties)
          await db.query('INSERT INTO scholar_specialties(scholar_id,specialty_id) VALUES($1,$2)', [
            id,
            s,
          ]);
        await record(db, user.id, await load(db, id), 'DRAFT');
      });
      res.status(201).json({ data: await detail(await load(pool, id)) });
    }),
  );
  router.put(
    '/api/v2/experts/me',
    endpoint(async (req, res) => {
      const { user, row } = await mine(req);
      if (!row) throw new ServiceError(404, 'NOT_FOUND');
      const data = z
        .object({ profile: professionalSchema, revision: z.number().int().nonnegative() })
        .strict()
        .parse(req.body);
      await taxonomy(req, data.profile);
      await pinImage(req, data.profile.image_id, user.public_id, 'scholar-image:' + row.id);
      await transaction(pool, async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(8002)');
        const current = await load(db, row.id, true);
        if (current.revision !== data.revision) throw new ServiceError(409, 'CONFLICT');
        if (['SUBMITTED', 'UNDER_REVIEW', 'SUSPENDED'].includes(current.status))
          throw new ServiceError(409, 'APPLICATION_LOCKED');
        if (
          (
            await db.query('SELECT 1 FROM scholars WHERE slug=$1 AND id<>$2', [
              data.profile.slug,
              row.id,
            ])
          ).rowCount
        )
          throw new ServiceError(409, 'SLUG_TAKEN');
        // Approved professional content must pass review again before it is republished.
        const status = current.status === 'APPROVED' ? 'DRAFT' : current.status;
        await db.query(
          'UPDATE scholars SET slug=$2,profile=$3,status=$4,revision=revision+1,updated_at=now() WHERE id=$1',
          [row.id, data.profile.slug, data.profile, status],
        );
        await db.query(
          'DELETE FROM scholar_specialties WHERE scholar_id=$1 AND NOT(specialty_id=ANY($2::uuid[]))',
          [row.id, data.profile.specialties],
        );
        for (const s of data.profile.specialties)
          await db.query(
            'INSERT INTO scholar_specialties(scholar_id,specialty_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
            [row.id, s],
          );
        await record(db, user.id, current, 'PROFILE_UPDATED');
      });
      res.json({ data: await detail(await load(pool, row.id)) });
    }),
  );
  router.post(
    '/api/v2/experts/me/submit',
    endpoint(async (req, res) => {
      const { user, row } = await mine(req);
      if (!row) throw new ServiceError(404, 'NOT_FOUND');
      await taxonomy(req, row.profile);
      const docs = await documents(pool, row.id);
      for (const d of docs.filter((d) => !['REJECTED', 'EXPIRED'].includes(d.status)))
        await fileReady(req, d.details.file_id, 'document', user.public_id);
      await transaction(pool, async (db) => {
        const current = await load(db, row.id, true);
        if (current.revision !== row.revision) throw new ServiceError(409, 'CONFLICT');
        assertTransition(current.status, 'SUBMITTED');
        const currentDocs = await documents(db, row.id);
        if (
          missingProfessional(
            current.profile,
            currentDocs.map((d) => ({ status: d.status, expires_at: d.details.expires_at })),
          ).length
        )
          throw new ServiceError(409, 'INCOMPLETE_PROFILE');
        await db.query(
          "UPDATE scholars SET status='SUBMITTED',submitted_at=now(),revision=revision+1,updated_at=now() WHERE id=$1",
          [row.id],
        );
        await record(db, user.id, current, 'SUBMITTED');
      });
      res.json({ data: await detail(await load(pool, row.id)) });
    }),
  );
  router.post(
    '/api/v2/experts/me/documents',
    endpoint(async (req, res) => {
      const { user, row } = await mine(req);
      if (!row) throw new ServiceError(404, 'NOT_FOUND');
      const input = documentSchema.parse(req.body);
      await fileReady(req, input.file_id, 'document', user.public_id);
      const id = randomUUID();
      // Reserving a reference before the metadata transaction prevents deletion races. Failed requests retain a conservative reference for reconciliation.
      await internalCall('file-service', '/internal/files/reference', auth(req), {
        id: input.file_id,
        owner: user.public_id,
        reference: 'scholar-document:' + id,
      });
      await transaction(pool, async (db) => {
        const current = await load(db, row.id, true);
        if (['SUBMITTED', 'UNDER_REVIEW', 'SUSPENDED'].includes(current.status))
          throw new ServiceError(409, 'APPLICATION_LOCKED');
        if (
          (
            await db.query(
              'SELECT 1 FROM scholar_documents WHERE scholar_id=$1 AND deleted_at IS NULL OFFSET 49 LIMIT 1',
              [row.id],
            )
          ).rowCount
        )
          throw new ServiceError(409, 'DOCUMENT_LIMIT');
        await db.query('INSERT INTO scholar_documents(id,scholar_id,details) VALUES($1,$2,$3)', [
          id,
          row.id,
          input,
        ]);
        await db.query('UPDATE scholars SET revision=revision+1 WHERE id=$1', [row.id]);
        await record(db, user.id, current, 'DOCUMENT_ADDED', id);
      });
      res.status(201).json({ data: { id } });
    }),
  );
  router.post(
    '/api/v2/experts/me/documents/:id/remove',
    endpoint(async (req, res) => {
      const { user, row } = await mine(req);
      if (!row) throw new ServiceError(404, 'NOT_FOUND');
      const id = z.string().uuid().parse(req.params.id);
      const document = (
        await pool.query('SELECT details FROM scholar_documents WHERE id=$1 AND scholar_id=$2', [
          id,
          row.id,
        ])
      ).rows[0];
      if (!document) throw new ServiceError(404, 'NOT_FOUND');
      await transaction(pool, async (db) => {
        const current = await load(db, row.id, true);
        if (['SUBMITTED', 'UNDER_REVIEW', 'SUSPENDED', 'APPROVED'].includes(current.status))
          throw new ServiceError(409, 'APPLICATION_LOCKED');
        if (
          !(
            await db.query(
              'UPDATE scholar_documents SET deleted_at=coalesce(deleted_at,now()) WHERE id=$1 AND scholar_id=$2 RETURNING id',
              [id, row.id],
            )
          ).rowCount
        )
          throw new ServiceError(404, 'NOT_FOUND');
        await db.query('UPDATE scholars SET revision=revision+1 WHERE id=$1', [row.id]);
        await record(db, user.id, current, 'DOCUMENT_REMOVED', id);
      });
      await internalCall('file-service', '/internal/files/release-document', auth(req), {
        id: document.details.file_id,
        document_id: id,
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.get(
    '/api/v2/experts/admin',
    endpoint(async (req, res) => {
      await requirePermission(req, 'expert.read');
      const query = z
        .object({
          status: applicationStatus.optional(),
          q: z.string().max(120).optional(),
          specialty: z.string().uuid().optional(),
          language: z.string().uuid().optional(),
          from: z.string().date().optional(),
          to: z.string().date().optional(),
          documents: z.enum(['missing', 'expired']).optional(),
          offset: z.coerce.number().int().min(0).max(100000).default(0),
        })
        .strict()
        .parse(req.query);
      let contactCodes: string[] | null = null;
      if (query.q && /[@+\d]/.test(query.q)) {
        const accounts = await internalCall<{ public_id: string }[]>(
          'identity-service',
          '/internal/expert-contact-search',
          auth(req),
          { query: query.q },
        );
        contactCodes = accounts.map((a) => a.public_id);
      }
      const rows = await pool.query(
        `SELECT id,public_id,slug,status,revision,profile->>'display_name' AS display_name,submitted_at FROM scholars s
      WHERE ($1::text IS NULL OR status=$1) AND ($2::text IS NULL OR profile->>'display_name' ILIKE '%'||$2||'%' OR profile->>'contact_phone' ILIKE '%'||$2||'%' OR public_id=ANY($3::text[]))
      AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM scholar_specialties WHERE scholar_id=s.id AND specialty_id=$4))
      AND ($5::text IS NULL OR profile->'languages' @> jsonb_build_array(jsonb_build_object('id',$5::text)))
      AND ($6::date IS NULL OR submitted_at >= $6::date) AND ($7::date IS NULL OR submitted_at < $7::date+1)
      AND ($8::text IS NULL OR ($8='missing' AND NOT EXISTS(SELECT 1 FROM scholar_documents WHERE scholar_id=s.id AND deleted_at IS NULL)) OR ($8='expired' AND EXISTS(SELECT 1 FROM scholar_documents WHERE scholar_id=s.id AND deleted_at IS NULL AND details->>'expires_at'<to_char(current_date,'YYYY-MM-DD'))))
      ORDER BY submitted_at DESC NULLS LAST,id LIMIT 50 OFFSET $9`,
        [
          query.status ?? null,
          query.q ?? null,
          contactCodes ?? [],
          query.specialty ?? null,
          query.language ?? null,
          query.from ?? null,
          query.to ?? null,
          query.documents ?? null,
          query.offset,
        ],
      );
      res.json({ data: rows.rows });
    }),
  );
  router.get(
    '/api/v2/experts/admin/:id',
    endpoint(async (req, res) => {
      await requirePermission(req, 'expert.read');
      res.json({
        data: await detail(await load(pool, z.string().uuid().parse(req.params.id)), true),
      });
    }),
  );
  router.post(
    '/api/v2/experts/admin/:id/review',
    endpoint(async (req, res) => {
      const input = reviewSchema.parse(req.body);
      const permission =
        input.status === 'APPROVED'
          ? 'expert.approve'
          : input.status === 'SUSPENDED'
            ? 'expert.suspend'
            : 'expert.review';
      const user = await requirePermission(req, permission);
      const id = z.string().uuid().parse(req.params.id);
      const snapshot = await load(pool, id);
      if (input.status === 'APPROVED') {
        if (input.valid_until && Date.parse(input.valid_until) <= Date.now())
          throw new ServiceError(400, 'INVALID_EXPIRY');
        await taxonomy(req, snapshot.profile);
        for (const d of (await documents(pool, id)).filter((d) => d.status === 'APPROVED'))
          await fileReady(req, d.details.file_id, 'document', snapshot.public_id);
      }
      await transaction(pool, async (db) => {
        const row = await load(db, id, true);
        if (row.account_id === user.id) throw new ServiceError(403, 'SELF_REVIEW');
        if (row.revision !== input.revision || row.revision !== snapshot.revision)
          throw new ServiceError(409, 'CONFLICT');
        assertTransition(row.status, input.status);
        if (input.status === 'APPROVED') {
          const docs = await documents(db, id);
          const specs = (
            await db.query(
              "SELECT 1 FROM scholar_specialties WHERE scholar_id=$1 AND status='APPROVED'",
              [id],
            )
          ).rowCount;
          if (
            !specs ||
            !docs.some((d) => d.status === 'APPROVED') ||
            docs.some((d) => d.status === 'PENDING') ||
            missingProfessional(
              row.profile,
              docs.map((d) => ({ status: d.status, expires_at: d.details.expires_at })),
            ).length
          )
            throw new ServiceError(409, 'REVIEW_INCOMPLETE');
        }
        await db.query(
          'UPDATE scholars SET status=$2,valid_until=$3,revision=revision+1,updated_at=now() WHERE id=$1',
          [id, input.status, input.status === 'APPROVED' ? input.valid_until : null],
        );
        await db.query(
          'INSERT INTO scholar_decisions(scholar_id,actor_id,status,reason,internal_note) VALUES($1,$2,$3,$4,$5)',
          [id, user.id, input.status, input.reason, input.internal_note],
        );
        await record(db, user.id, row, input.status);
      });
      res.json({ data: await detail(await load(pool, id), true) });
    }),
  );
  for (const kind of ['documents', 'specialties'] as const)
    router.post(
      '/api/v2/experts/admin/:id/' + kind + '/:item/review',
      endpoint(async (req, res) => {
        const user = await requirePermission(
          req,
          kind === 'documents' ? 'expert.document.review' : 'expert.review',
        );
        const id = z.string().uuid().parse(req.params.id),
          item = z.string().uuid().parse(req.params.item);
        const input = z
          .object({
            status: z.enum(['APPROVED', 'REJECTED']),
            reason: z.string().trim().min(1).max(2000),
          })
          .strict()
          .parse(req.body);
        const snapshot = await load(pool, id);
        if (kind === 'documents' && input.status === 'APPROVED') {
          const doc = (await documents(pool, id)).find((d) => d.id === item);
          if (!doc || doc.status === 'EXPIRED') throw new ServiceError(409, 'INVALID_DOCUMENT');
          await fileReady(req, doc.details.file_id, 'document', snapshot.public_id);
        }
        await transaction(pool, async (db) => {
          const row = await load(db, id, true);
          if (row.account_id === user.id) throw new ServiceError(403, 'SELF_REVIEW');
          if (row.status !== 'UNDER_REVIEW') throw new ServiceError(409, 'INVALID_TRANSITION');
          const result =
            kind === 'documents'
              ? await db.query(
                  'UPDATE scholar_documents SET status=$3,reason=$4 WHERE scholar_id=$1 AND id=$2 AND deleted_at IS NULL',
                  [id, item, input.status, input.reason],
                )
              : await db.query(
                  'UPDATE scholar_specialties SET status=$3,reason=$4 WHERE scholar_id=$1 AND specialty_id=$2',
                  [id, item, input.status, input.reason],
                );
          if (!result.rowCount) throw new ServiceError(404, 'NOT_FOUND');
          await db.query('UPDATE scholars SET revision=revision+1 WHERE id=$1', [id]);
          await record(db, user.id, row, kind.toUpperCase() + '_' + input.status, item);
        });
        res.json({ data: { ok: true } });
      }),
    );
  router.get(
    '/api/v2/experts/settings',
    endpoint(async (req, res) => {
      await requirePermission(req, 'service.manage');
      res.json({
        data: (await pool.query('SELECT review_services FROM scholar_settings WHERE id=1')).rows[0],
      });
    }),
  );
  router.put(
    '/api/v2/experts/settings',
    endpoint(async (req, res) => {
      await requirePermission(req, 'service.manage');
      const input = z.object({ review_services: z.boolean() }).strict().parse(req.body);
      await pool.query('UPDATE scholar_settings SET review_services=$1 WHERE id=1', [
        input.review_services,
      ]);
      res.json({ data: input });
    }),
  );
  router.post(
    '/api/v2/experts/me/services',
    endpoint(async (req, res) => {
      const { user, row } = await mine(req);
      if (!row) throw new ServiceError(404, 'NOT_FOUND');
      const input = offeringSchema.parse(req.body);
      await internalCall('taxonomy-service', '/internal/taxonomy/validate', auth(req), {
        specialties: [input.specialty_id],
        languages: [],
        categories: input.category_id ? [input.category_id] : [],
      });
      const id = randomUUID();
      await pinImage(req, input.image_id, user.public_id, 'scholar-service:' + id);
      await transaction(pool, async (db) => {
        const current = await load(db, row.id, true);
        if (!isVerified(current.status, current.valid_until))
          throw new ServiceError(409, 'EXPERT_UNAVAILABLE');
        if (
          !(
            await db.query(
              "SELECT 1 FROM scholar_specialties WHERE scholar_id=$1 AND specialty_id=$2 AND status='APPROVED'",
              [row.id, input.specialty_id],
            )
          ).rowCount
        )
          throw new ServiceError(403, 'SPECIALTY_UNAPPROVED');
        await db.query('INSERT INTO scholar_offerings(id,scholar_id,details) VALUES($1,$2,$3)', [
          id,
          row.id,
          input,
        ]);
        await record(db, user.id, current, 'SERVICE_CREATED', id);
      });
      res.status(201).json({ data: { id } });
    }),
  );
  router.put(
    '/api/v2/experts/me/services/:id',
    endpoint(async (req, res) => {
      const { user, row } = await mine(req);
      if (!row) throw new ServiceError(404, 'NOT_FOUND');
      const id = z.string().uuid().parse(req.params.id);
      const input = z
        .object({ details: offeringSchema, revision: z.number().int().nonnegative() })
        .strict()
        .parse(req.body);
      await internalCall('taxonomy-service', '/internal/taxonomy/validate', auth(req), {
        specialties: [input.details.specialty_id],
        languages: [],
        categories: input.details.category_id ? [input.details.category_id] : [],
      });
      await pinImage(req, input.details.image_id, user.public_id, 'scholar-service:' + id);
      await transaction(pool, async (db) => {
        const current = await load(db, row.id, true);
        if (!isVerified(current.status, current.valid_until))
          throw new ServiceError(409, 'EXPERT_UNAVAILABLE');
        if (
          !(
            await db.query(
              "SELECT 1 FROM scholar_specialties WHERE scholar_id=$1 AND specialty_id=$2 AND status='APPROVED'",
              [row.id, input.details.specialty_id],
            )
          ).rowCount
        )
          throw new ServiceError(403, 'SPECIALTY_UNAPPROVED');
        if (
          !(
            await db.query(
              "UPDATE scholar_offerings SET details=$3,status='DRAFT',revision=revision+1 WHERE id=$1 AND scholar_id=$2 AND revision=$4",
              [id, row.id, input.details, input.revision],
            )
          ).rowCount
        )
          throw new ServiceError(409, 'CONFLICT');
        await record(db, user.id, current, 'SERVICE_UPDATED', id);
      });
      res.json({ data: { id } });
    }),
  );
  router.post(
    '/api/v2/experts/me/services/:id/publish',
    endpoint(async (req, res) => {
      const { user, row } = await mine(req);
      if (!row) throw new ServiceError(404, 'NOT_FOUND');
      const id = z.string().uuid().parse(req.params.id);
      await transaction(pool, async (db) => {
        const current = await load(db, row.id, true);
        if (!isVerified(current.status, current.valid_until))
          throw new ServiceError(409, 'EXPERT_UNAVAILABLE');
        const offering = (
          await db.query(
            'SELECT * FROM scholar_offerings WHERE id=$1 AND scholar_id=$2 FOR UPDATE',
            [id, row.id],
          )
        ).rows[0];
        if (!offering || !['DRAFT', 'REJECTED', 'DISABLED'].includes(offering.status))
          throw new ServiceError(409, 'INVALID_TRANSITION');
        if (
          !(
            await db.query(
              "SELECT 1 FROM scholar_specialties WHERE scholar_id=$1 AND specialty_id=$2 AND status='APPROVED'",
              [row.id, offering.details.specialty_id],
            )
          ).rowCount
        )
          throw new ServiceError(403, 'SPECIALTY_UNAPPROVED');
        const review = (await db.query('SELECT review_services FROM scholar_settings WHERE id=1'))
          .rows[0].review_services;
        await db.query('UPDATE scholar_offerings SET status=$2,revision=revision+1 WHERE id=$1', [
          id,
          review ? 'PENDING_REVIEW' : 'PUBLISHED',
        ]);
        await record(db, user.id, current, 'SERVICE_SUBMITTED', id);
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.post(
    '/api/v2/experts/me/services/:id/disable',
    endpoint(async (req, res) => {
      const { row } = await mine(req);
      if (!row) throw new ServiceError(404, 'NOT_FOUND');
      const id = z.string().uuid().parse(req.params.id);
      if (
        !(
          await pool.query(
            "UPDATE scholar_offerings SET status='DISABLED',revision=revision+1 WHERE id=$1 AND scholar_id=$2",
            [id, row.id],
          )
        ).rowCount
      )
        throw new ServiceError(404, 'NOT_FOUND');
      res.json({ data: { ok: true } });
    }),
  );
  router.post(
    '/api/v2/experts/admin/:id/services/:item/review',
    endpoint(async (req, res) => {
      const user = await requirePermission(req, 'service.manage');
      const id = z.string().uuid().parse(req.params.id),
        item = z.string().uuid().parse(req.params.item);
      const input = z
        .object({
          status: z.enum(['PUBLISHED', 'REJECTED', 'DISABLED']),
          reason: z.string().trim().min(1).max(2000),
          revision: z.number().int().nonnegative(),
        })
        .strict()
        .parse(req.body);
      await transaction(pool, async (db) => {
        const row = await load(db, id, true);
        if (row.account_id === user.id) throw new ServiceError(403, 'SELF_REVIEW');
        if (!isVerified(row.status, row.valid_until) && input.status === 'PUBLISHED')
          throw new ServiceError(409, 'EXPERT_UNAVAILABLE');
        const offering = (
          await db.query(
            'SELECT * FROM scholar_offerings WHERE id=$1 AND scholar_id=$2 FOR UPDATE',
            [item, id],
          )
        ).rows[0];
        if (
          !offering ||
          offering.revision !== input.revision ||
          (input.status !== 'DISABLED' && offering.status !== 'PENDING_REVIEW')
        )
          throw new ServiceError(409, 'CONFLICT');
        await db.query(
          'UPDATE scholar_offerings SET status=$2,reason=$3,revision=revision+1 WHERE id=$1',
          [item, input.status, input.reason],
        );
        await record(db, user.id, row, 'SERVICE_' + input.status, item);
      });
      res.json({ data: { ok: true } });
    }),
  );
  router.get(
    '/api/v2/experts/notifications',
    endpoint(async (req, res) => {
      const user = await principal(req);
      res.json({
        data: (
          await pool.query(
            'SELECT id,event,created_at,read_at FROM scholar_notifications WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100',
            [user.id],
          )
        ).rows,
      });
    }),
  );
  router.get(
    '/api/v2/experts/public',
    endpoint(async (_req, res) => {
      const rows = (
        await pool.query(
          "SELECT slug,public_id,profile->>'display_name' AS display_name,profile->>'title' AS title,profile->>'short_bio' AS short_bio FROM scholars WHERE status='APPROVED' AND (valid_until IS NULL OR valid_until>now()) AND profile->>'visibility'='PUBLIC' ORDER BY slug LIMIT 100",
        )
      ).rows;
      const active = await internalCall<string[]>(
        'identity-service',
        '/internal/active-accounts',
        '',
        { codes: rows.map((r) => r.public_id) },
      );
      res.json({ data: rows.filter((r) => active.includes(r.public_id)) });
    }),
  );
  router.get(
    '/api/v2/experts/public/:slug',
    endpoint(async (req, res) => {
      const slug = z
        .string()
        .regex(/^[a-z0-9-]{3,80}$/)
        .parse(req.params.slug);
      const row = (
        await pool.query(
          "SELECT *,valid_until::text FROM scholars WHERE slug=$1 AND status='APPROVED' AND (valid_until IS NULL OR valid_until>now()) AND profile->>'visibility'='PUBLIC'",
          [slug],
        )
      ).rows[0] as Scholar | undefined;
      if (!row) throw new ServiceError(404, 'NOT_FOUND');
      const active = await internalCall<string[]>(
        'identity-service',
        '/internal/active-accounts',
        '',
        { codes: [row.public_id] },
      );
      if (!active.length) throw new ServiceError(404, 'NOT_FOUND');
      const currentTaxons = await internalCall<{ id: string }[]>(
        'taxonomy-service',
        '/api/v2/taxonomy',
      );
      const specialties = (
        await pool.query(
          "SELECT specialty_id FROM scholar_specialties WHERE scholar_id=$1 AND status='APPROVED'",
          [row.id],
        )
      ).rows
        .map((r) => r.specialty_id)
        .filter((id) => currentTaxons.some((t) => t.id === id));
      const {
        image_id,
        display_name,
        title,
        short_bio,
        biography,
        experience,
        education,
        years,
        city,
        country,
        links,
        languages,
        viewpoints,
        seo_title,
        seo_description,
      } = row.profile;
      res.json({
        data: {
          slug,
          public_id: row.public_id,
          verified: true,
          profile: {
            image_id,
            display_name,
            title,
            short_bio,
            biography,
            experience,
            education,
            years,
            city,
            country,
            links,
            languages,
            viewpoints,
            seo_title,
            seo_description,
          },
          specialties,
          documents: (await documents(pool, row.id))
            .filter(
              (d) =>
                d.status === 'APPROVED' &&
                d.details.public_summary &&
                d.details.kind !== 'IDENTITY',
            )
            .map((d) => ({
              title: d.details.title,
              issuer: d.details.issuer,
              kind: d.details.kind,
            })),
          services: (
            await pool.query(
              "SELECT id,details FROM scholar_offerings WHERE scholar_id=$1 AND status='PUBLISHED' AND details->>'specialty_id'=ANY($2::text[])",
              [row.id, specialties],
            )
          ).rows,
        },
      });
    }),
  );
  return router;
}
