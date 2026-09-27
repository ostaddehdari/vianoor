import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  internalRouter,
  endpoint,
  principal,
  requirePermission,
  internalCall,
  ServiceError,
  sealJson,
  openJson,
  transaction,
} from '@vianoor/service-runtime';
const uuid = z.string().uuid(),
  seal = (v: unknown, id: string) => sealJson(v, 'question:' + id, 'COMMUNICATION_ENCRYPTION_KEY'),
  open = (v: string, id: string) => openJson(v, 'question:' + id, 'COMMUNICATION_ENCRYPTION_KEY');
export async function initializeQuestions(pool: Pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS questions(id uuid PRIMARY KEY,owner_id uuid NOT NULL,owner_code varchar(13) NOT NULL,expert_id uuid,sealed_question text NOT NULL,sealed_answer text,visibility text NOT NULL DEFAULT 'PRIVATE',public_question text,public_answer text,publication text NOT NULL DEFAULT 'PRIVATE',request_key uuid NOT NULL,revision int NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(owner_id,request_key));CREATE TABLE IF NOT EXISTS question_audit(id bigserial PRIMARY KEY,question_id uuid NOT NULL,actor_id uuid NOT NULL,action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());`,
  );
}
export function questionRouter(pool: Pool) {
  const r = internalRouter();
  r.get(
    '/api/v2/questions/public',
    endpoint(async (_req, res) => {
      res.json({
        data: (
          await pool.query(
            "SELECT id,public_question AS question,public_answer AS answer,CASE WHEN visibility='PUBLIC' THEN owner_code ELSE NULL END AS author,updated_at FROM questions WHERE publication='PUBLISHED' AND visibility IN ('PUBLIC','ANONYMOUS') ORDER BY updated_at DESC LIMIT 100",
          )
        ).rows,
      });
    }),
  );
  r.get(
    '/api/v2/questions',
    endpoint(async (req, res) => {
      const u = await principal(req);
      res.json({
        data: (
          await pool.query(
            'SELECT * FROM questions WHERE owner_id=$1 OR expert_id=$1 ORDER BY updated_at DESC LIMIT 100',
            [u.id],
          )
        ).rows.map((q) => ({
          id: q.id,
          is_owner: q.owner_id === u.id,
          can_answer: q.expert_id === u.id,
          owner_id: q.owner_id,
          expert_id: q.expert_id,
          question: open(q.sealed_question, q.id),
          answer: q.sealed_answer ? open(q.sealed_answer, q.id + ':answer') : null,
          visibility: q.visibility,
          publication: q.publication,
          revision: q.revision,
          created_at: q.created_at,
        })),
      });
    }),
  );
  r.post(
    '/api/v2/questions',
    endpoint(async (req, res) => {
      const u = await principal(req),
        d = z
          .object({ request_key: uuid, question: z.string().trim().min(3).max(12000) })
          .strict()
          .parse(req.body),
        id = randomUUID();
      const q = (
        await pool.query(
          'INSERT INTO questions(id,owner_id,owner_code,sealed_question,request_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id,request_key) DO UPDATE SET request_key=EXCLUDED.request_key RETURNING *',
          [id, u.id, u.public_id, seal(d.question, id), d.request_key],
        )
      ).rows[0];
      if (open(q.sealed_question, q.id) !== d.question)
        throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT');
      res.json({ data: { id: q.id, revision: q.revision } });
    }),
  );
  r.post(
    '/api/v2/questions/:id/answer',
    endpoint(async (req, res) => {
      const u = await principal(req),
        id = uuid.parse(req.params.id),
        d = z
          .object({
            answer: z.string().trim().min(1).max(20000),
            revision: z.number().int().positive(),
          })
          .strict()
          .parse(req.body);
      const result = await pool.query(
        "UPDATE questions SET sealed_answer=$3,publication=CASE WHEN visibility='PRIVATE' THEN 'PRIVATE' ELSE 'PENDING' END,revision=revision+1,updated_at=now() WHERE id=$1 AND expert_id=$2 AND revision=$4 RETURNING revision",
        [id, u.id, seal(d.answer, id + ':answer'), d.revision],
      );
      if (!result.rowCount) throw new ServiceError(409, 'CONFLICT');
      res.json({ data: result.rows[0] });
    }),
  );
  r.post(
    '/api/v2/questions/:id/visibility',
    endpoint(async (req, res) => {
      const u = await principal(req),
        id = uuid.parse(req.params.id),
        d = z
          .object({
            visibility: z.enum(['PRIVATE', 'PUBLIC', 'ANONYMOUS']),
            public_question: z.string().trim().max(12000).default(''),
            public_answer: z.string().trim().max(20000).default(''),
            revision: z.number().int().positive(),
          })
          .strict()
          .parse(req.body);
      if (d.visibility !== 'PRIVATE' && (!d.public_question || !d.public_answer))
        throw new ServiceError(400, 'PUBLIC_COPY_REQUIRED');
      const q = await pool.query(
        "UPDATE questions SET visibility=$3,public_question=$4,public_answer=$5,publication=CASE WHEN $3='PRIVATE' THEN 'PRIVATE' ELSE 'PENDING' END,revision=revision+1,updated_at=now() WHERE id=$1 AND owner_id=$2 AND revision=$6 RETURNING revision",
        [
          id,
          u.id,
          d.visibility,
          d.visibility === 'PRIVATE' ? null : d.public_question,
          d.visibility === 'PRIVATE' ? null : d.public_answer,
          d.revision,
        ],
      );
      if (!q.rowCount) throw new ServiceError(409, 'CONFLICT');
      await pool.query(
        "INSERT INTO question_audit(question_id,actor_id,action) VALUES($1,$2,'OWNER_PUBLICATION_CONSENT')",
        [id, u.id],
      );
      res.json({ data: q.rows[0] });
    }),
  );
  r.get(
    '/api/v2/questions/admin',
    endpoint(async (req, res) => {
      await requirePermission(req, 'question.manage');
      res.json({
        data: (
          await pool.query(
            'SELECT id,owner_code,expert_id,visibility,publication,public_question,public_answer,revision,created_at FROM questions ORDER BY updated_at DESC LIMIT 100',
          )
        ).rows,
      });
    }),
  );
  r.post(
    '/api/v2/questions/:id/assign',
    endpoint(async (req, res) => {
      const u = await requirePermission(req, 'question.manage'),
        id = uuid.parse(req.params.id),
        d = z
          .object({
            expert: z.string().regex(/^[A-Za-z0-9]{13}$/),
            revision: z.number().int().positive(),
          })
          .strict()
          .parse(req.body),
        expert = await internalCall<{ account_id: string }>(
          'scholar-service',
          '/internal/communications/expert/' + d.expert,
          req.get('authorization') ?? '',
        );
      await transaction(pool, async (db) => {
        const q = (await db.query('SELECT * FROM questions WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!q) throw new ServiceError(404, 'NOT_FOUND');
        if (q.revision !== d.revision || q.expert_id) throw new ServiceError(409, 'CONFLICT');
        await db.query(
          'UPDATE questions SET expert_id=$2,revision=revision+1,updated_at=now() WHERE id=$1',
          [id, expert.account_id],
        );
        await db.query(
          "INSERT INTO question_audit(question_id,actor_id,action) VALUES($1,$2,'ASSIGNED')",
          [id, u.id],
        );
      });
      res.json({ data: { ok: true } });
    }),
  );
  r.post(
    '/api/v2/questions/:id/review',
    endpoint(async (req, res) => {
      const u = await requirePermission(req, 'question.manage'),
        id = uuid.parse(req.params.id),
        d = z
          .object({ publish: z.boolean(), revision: z.number().int().positive() })
          .strict()
          .parse(req.body);
      const q = await pool.query(
        "UPDATE questions SET publication=$3,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 AND visibility<>'PRIVATE' AND publication='PENDING' AND public_question IS NOT NULL AND public_answer IS NOT NULL RETURNING id",
        [id, d.revision, d.publish ? 'PUBLISHED' : 'REJECTED'],
      );
      if (!q.rowCount) throw new ServiceError(409, 'CONFLICT');
      await pool.query('INSERT INTO question_audit(question_id,actor_id,action) VALUES($1,$2,$3)', [
        id,
        u.id,
        d.publish ? 'PUBLISHED' : 'REJECTED',
      ]);
      res.json({ data: { ok: true } });
    }),
  );
  r.get(
    '/internal/questions/:id/context',
    endpoint(async (req, res) => {
      const u = await principal(req),
        q = (
          await pool.query('SELECT owner_id,expert_id FROM questions WHERE id=$1', [
            uuid.parse(req.params.id),
          ])
        ).rows[0];
      if (!q || !q.expert_id || ![q.owner_id, q.expert_id].includes(u.id))
        throw new ServiceError(403, 'FORBIDDEN');
      res.json({ data: q });
    }),
  );
  r.post(
    '/api/v2/questions/:id/conversation',
    endpoint(async (req, res) => {
      await principal(req);
      res.json({
        data: await internalCall(
          'messaging-service',
          '/internal/communications/question',
          req.get('authorization') ?? '',
          { question_id: uuid.parse(req.params.id) },
        ),
      });
    }),
  );
  return r;
}
