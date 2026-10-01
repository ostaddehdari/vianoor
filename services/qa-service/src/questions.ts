import { randomUUID } from 'node:crypto';

import type {
  Pool,
  PoolClient,
} from 'pg';

import {
  z,
} from 'zod';

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

const uuid =
  z.string().uuid();

const languageCode =
  z
    .string()
    .trim()
    .regex(
      /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/,
    )
    .max(35);

const tagSchema =
  z
    .string()
    .trim()
    .min(1)
    .max(40);

const seal = (
  value: unknown,
  id: string,
) =>
  sealJson(
    value,
    'question:' + id,
    'COMMUNICATION_ENCRYPTION_KEY',
  );

const open = (
  value: string,
  id: string,
) =>
  openJson(
    value,
    'question:' + id,
    'COMMUNICATION_ENCRYPTION_KEY',
  );

type QuestionRow = {
  id: string;
  owner_id: string;
  owner_code: string;
  expert_id: string | null;
  sealed_question: string;
  sealed_answer: string | null;
  visibility: string;
  public_question: string | null;
  public_answer: string | null;
  publication: string;
  request_key: string;
  revision: number;
  created_at: string;
  updated_at: string;

  title: string | null;
  category_id: string | null;
  tags: string[];
  language: string;
  views: number;
  accepted_answer_id: string | null;
};

type AnswerRow = {
  id: string;
  question_id: string;
  author_id: string;
  author_code: string;
  sealed_body: string;
  public_body: string | null;
  publication: string;
  created_at: string;
  updated_at: string;
};

async function question(
  db: Pool | PoolClient,
  id: string,
) {
  return (
    await db.query(
      'SELECT * FROM questions WHERE id=$1',
      [
        id,
      ],
    )
  ).rows[0] as
    | QuestionRow
    | undefined;
}

async function validateMetadata(
  categoryId:
    | string
    | undefined,
  language:
    | string
    | undefined,
) {
  if (
    categoryId
  )
    await internalCall(
      'taxonomy-service',
      '/internal/taxonomy/validate',
      '',
      {
        specialties:
          [],

        languages:
          [],

        categories: [
          categoryId,
        ],
      },
    );

  if (
    language &&
    language !==
      'und'
  )
    await internalCall(
      'taxonomy-service',
      '/api/v2/languages/' +
        encodeURIComponent(
          language,
        ),
    );
}

function answerBody(
  row: AnswerRow,
) {
  return open(
    row.sealed_body,
    'answer:' +
      row.id,
  );
}

export async function initializeQuestions(
  pool: Pool,
) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS questions(
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL,
      owner_code varchar(13) NOT NULL,
      expert_id uuid,
      sealed_question text NOT NULL,
      sealed_answer text,
      visibility text NOT NULL DEFAULT 'PRIVATE',
      public_question text,
      public_answer text,
      publication text NOT NULL DEFAULT 'PRIVATE',
      request_key uuid NOT NULL,
      revision int NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(owner_id,request_key)
    );

    CREATE TABLE IF NOT EXISTS question_audit(
      id bigserial PRIMARY KEY,
      question_id uuid NOT NULL,
      actor_id uuid NOT NULL,
      action text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS title text;

    ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS category_id uuid;

    ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS tags text[]
      NOT NULL DEFAULT ARRAY[]::text[];

    ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS language text
      NOT NULL DEFAULT 'und';

    ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS views int
      NOT NULL DEFAULT 0;

    ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS accepted_answer_id uuid;

    CREATE TABLE IF NOT EXISTS question_answers(
      id uuid PRIMARY KEY,
      question_id uuid NOT NULL
        REFERENCES questions(id)
        ON DELETE CASCADE,
      author_id uuid NOT NULL,
      author_code varchar(13) NOT NULL,
      sealed_body text NOT NULL,
      public_body text,
      publication text NOT NULL DEFAULT 'PRIVATE',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS question_answers_question_idx
      ON question_answers(question_id,created_at);

    CREATE TABLE IF NOT EXISTS question_comments(
      id uuid PRIMARY KEY,
      question_id uuid NOT NULL
        REFERENCES questions(id)
        ON DELETE CASCADE,
      answer_id uuid
        REFERENCES question_answers(id)
        ON DELETE CASCADE,
      author_id uuid NOT NULL,
      author_code varchar(13) NOT NULL,
      body text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK(
        answer_id IS NULL
        OR answer_id IS NOT NULL
      )
    );

    CREATE INDEX IF NOT EXISTS question_comments_question_idx
      ON question_comments(question_id,created_at);

    CREATE INDEX IF NOT EXISTS question_comments_answer_idx
      ON question_comments(answer_id,created_at);

    CREATE TABLE IF NOT EXISTS question_translations(
      question_id uuid NOT NULL
        REFERENCES questions(id)
        ON DELETE CASCADE,
      language text NOT NULL,
      title text NOT NULL,
      question text NOT NULL,
      accepted_answer text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(question_id,language)
    );

    CREATE INDEX IF NOT EXISTS questions_public_feed_idx
      ON questions(publication,visibility,updated_at DESC);

    CREATE INDEX IF NOT EXISTS questions_category_idx
      ON questions(category_id);

    CREATE INDEX IF NOT EXISTS questions_language_idx
      ON questions(language);
  `);
}

export function questionRouter(
  pool: Pool,
) {
  const r =
    internalRouter();

  /*
   * Public Q&A feed.
   *
   * Supports:
   * - search
   * - topic
   * - tag
   * - language
   * - latest
   * - unanswered
   * - popular
   */
  r.get(
    '/api/v2/questions/public',
    endpoint(
      async (
        req,
        res,
      ) => {
        const input =
          z
            .object({
              expert:
                z
                  .string()
                  .regex(
                    /^[A-Za-z0-9]{13}$/,
                  )
                  .optional(),

              q:
                z
                  .string()
                  .trim()
                  .max(300)
                  .default(
                    '',
                  ),

              topic:
                uuid.optional(),

              tag:
                z
                  .string()
                  .trim()
                  .max(40)
                  .default(
                    '',
                  ),

              language:
                languageCode
                  .optional(),

              filter:
                z
                  .enum([
                    'latest',
                    'unanswered',
                    'popular',
                  ])
                  .default(
                    'latest',
                  ),

              offset:
                z.coerce
                  .number()
                  .int()
                  .min(0)
                  .max(100000)
                  .default(
                    0,
                  ),

              limit:
                z.coerce
                  .number()
                  .int()
                  .min(1)
                  .max(50)
                  .default(
                    20,
                  ),
            })
            .strict()
            .parse(
              req.query,
            );

        let expertId:
          | string
          | null =
            null;

        if (
          input.expert
        ) {
          const identities =
            await internalCall<
              {
                account_id:
                  string;

                expert_code:
                  string;
              }[]
            >(
              'scholar-service',
              '/internal/discovery/identities?' +
                new URLSearchParams({
                  codes:
                    input.expert,
                }),
            );

          expertId =
            identities[0]
              ?.account_id ??
            null;

          if (
            !expertId
          ) {
            res.json({
              data: {
                items:
                  [],

                next_offset:
                  null,
              },
            });

            return;
          }
        }

        const search =
          input.q
            ? `%${input.q}%`
            : '';

        const rows =
          (
            await pool.query(
              `
              SELECT
                q.id,
                COALESCE(
                  NULLIF(q.title,''),
                  left(q.public_question,140)
                ) AS title,
                q.public_question AS question,
                q.public_answer AS legacy_answer,
                CASE
                  WHEN q.visibility='PUBLIC'
                  THEN q.owner_code
                  ELSE NULL
                END AS author,
                q.category_id,
                q.tags,
                q.language,
                q.views,
                q.accepted_answer_id,
                q.created_at,
                q.updated_at,

                (
                  SELECT
                    count(*)::int
                  FROM question_answers a
                  WHERE a.question_id=q.id
                    AND a.publication='PUBLISHED'
                ) +
                CASE
                  WHEN q.public_answer IS NOT NULL
                    AND NOT EXISTS(
                      SELECT 1
                      FROM question_answers a2
                      WHERE a2.question_id=q.id
                        AND a2.publication='PUBLISHED'
                    )
                  THEN 1
                  ELSE 0
                END
                  AS answer_count,

                (
                  SELECT
                    count(*)::int
                  FROM question_comments c
                  WHERE c.question_id=q.id
                ) AS comment_count,

                (
                  q.public_answer IS NOT NULL
                  OR EXISTS(
                    SELECT 1
                    FROM question_answers a3
                    WHERE a3.question_id=q.id
                      AND a3.publication='PUBLISHED'
                  )
                ) AS answered

              FROM questions q

              WHERE q.publication='PUBLISHED'
                AND q.visibility IN (
                  'PUBLIC',
                  'ANONYMOUS'
                )

                AND (
                  $1::uuid IS NULL
                  OR q.expert_id=$1
                )

                AND (
                  $2::uuid IS NULL
                  OR q.category_id=$2
                )

                AND (
                  $3::text IS NULL
                  OR q.language=$3
                )

                AND (
                  $4=''
                  OR $4=ANY(q.tags)
                )

                AND (
                  $5=''
                  OR COALESCE(q.title,'')
                    ILIKE $5
                  OR q.public_question
                    ILIKE $5
                )

                AND (
                  $6<>'unanswered'
                  OR (
                    q.public_answer IS NULL
                    AND NOT EXISTS(
                      SELECT 1
                      FROM question_answers a4
                      WHERE a4.question_id=q.id
                        AND a4.publication='PUBLISHED'
                    )
                  )
                )

              ORDER BY
                CASE
                  WHEN $6='popular'
                  THEN q.views
                  ELSE 0
                END DESC,

                q.updated_at DESC,

                q.id

              LIMIT $7
              OFFSET $8
              `,
              [
                expertId,
                input.topic ??
                  null,
                input.language ??
                  null,
                input.tag,
                search,
                input.filter,
                input.limit +
                  1,
                input.offset,
              ],
            )
          ).rows;

        const hasMore =
          rows.length >
          input.limit;

        res.json({
          data: {
            items:
              rows.slice(
                0,
                input.limit,
              ),

            next_offset:
              hasMore
                ? input.offset +
                  input.limit
                : null,
          },
        });
      },
    ),
  );

  /*
   * Public question detail.
   *
   * Original content is always returned.
   * A stored translation is returned separately and is
   * never confused with the original.
   */
  r.get(
    '/api/v2/questions/public/:id',
    endpoint(
      async (
        req,
        res,
      ) => {
        const id =
          uuid.parse(
            req.params.id,
          );

        const requestedLanguage =
          z
            .string()
            .trim()
            .max(35)
            .optional()
            .parse(
              req.query.language,
            );

        const q =
          (
            await pool.query(
              `
              UPDATE questions
              SET views=views+1
              WHERE id=$1
                AND publication='PUBLISHED'
                AND visibility IN(
                  'PUBLIC',
                  'ANONYMOUS'
                )
              RETURNING *
              `,
              [
                id,
              ],
            )
          ).rows[0] as
            | QuestionRow
            | undefined;

        if (
          !q
        )
          throw new ServiceError(
            404,
            'NOT_FOUND',
          );

        const answers =
          (
            await pool.query(
              `
              SELECT *
              FROM question_answers
              WHERE question_id=$1
                AND publication='PUBLISHED'
              ORDER BY created_at,id
              `,
              [
                id,
              ],
            )
          ).rows as
            AnswerRow[];

        const comments =
          (
            await pool.query(
              `
              SELECT
                id,
                question_id,
                answer_id,
                author_code,
                body,
                created_at
              FROM question_comments
              WHERE question_id=$1
              ORDER BY created_at,id
              `,
              [
                id,
              ],
            )
          ).rows;

        let translation:
          | unknown
          | null =
            null;

        if (
          requestedLanguage &&
          requestedLanguage !==
            q.language
        )
          translation =
            (
              await pool.query(
                `
                SELECT
                  language,
                  title,
                  question,
                  accepted_answer,
                  updated_at
                FROM question_translations
                WHERE question_id=$1
                  AND language=$2
                `,
                [
                  id,
                  requestedLanguage,
                ],
              )
            ).rows[0] ??
            null;

        const presentedAnswers:
          {
            id:
              | string
              | null;

            body:
              | string
              | null;

            author:
              | string
              | null;

            accepted:
              boolean;

            created_at:
              string;

            comments:
              typeof comments;
          }[] =
          answers.map(
            (
              answer,
            ) => ({
              id:
                answer.id,

              body:
                answer.public_body,

              author:
                answer.author_code,

              accepted:
                q.accepted_answer_id ===
                answer.id,

              created_at:
                answer.created_at,

              comments:
                comments.filter(
                  (
                    comment,
                  ) =>
                    comment.answer_id ===
                    answer.id,
                ),
            }),
          );

        if (
          q.public_answer &&
          !presentedAnswers.length
        )
          presentedAnswers.push({
            id:
              null,

            body:
              q.public_answer,

            author:
              null,

            accepted:
              true,

            created_at:
              q.updated_at,

            comments:
              [],
          });

        res.json({
          data: {
            question: {
              id:
                q.id,

              title:
                q.title ||
                q.public_question?.slice(
                  0,
                  140,
                ) ||
                '',

              body:
                q.public_question,

              author:
                q.visibility ===
                'PUBLIC'
                  ? q.owner_code
                  : null,

              category_id:
                q.category_id,

              tags:
                q.tags,

              language:
                q.language,

              views:
                q.views,

              created_at:
                q.created_at,

              updated_at:
                q.updated_at,

              accepted_answer_id:
                q.accepted_answer_id,

              comments:
                comments.filter(
                  (
                    comment,
                  ) =>
                    !comment.answer_id,
                ),
            },

            answers:
              presentedAnswers,

            translation,
          },
        });
      },
    ),
  );

  /*
   * Authenticated user's questions.
   */
  r.get(
    '/api/v2/questions',
    endpoint(
      async (
        req,
        res,
      ) => {
        const u =
          await principal(
            req,
          );

        res.json({
          data:
            (
              await pool.query(
                `
                SELECT
                  q.*,

                  (
                    SELECT
                      count(*)::int
                    FROM question_answers a
                    WHERE a.question_id=q.id
                  ) AS answer_count

                FROM questions q
                WHERE owner_id=$1
                   OR expert_id=$1
                ORDER BY updated_at DESC
                LIMIT 100
                `,
                [
                  u.id,
                ],
              )
            ).rows.map(
              (
                q,
              ) => ({
                id:
                  q.id,

                is_owner:
                  q.owner_id ===
                  u.id,

                can_answer:
                  q.expert_id ===
                  u.id,

                owner_id:
                  q.owner_id,

                expert_id:
                  q.expert_id,

                title:
                  q.title,

                category_id:
                  q.category_id,

                tags:
                  q.tags,

                language:
                  q.language,

                views:
                  q.views,

                accepted_answer_id:
                  q.accepted_answer_id,

                answer_count:
                  q.answer_count,

                question:
                  open(
                    q.sealed_question,
                    q.id,
                  ),

                answer:
                  q.sealed_answer
                    ? open(
                        q.sealed_answer,
                        q.id +
                          ':answer',
                      )
                    : null,

                visibility:
                  q.visibility,

                publication:
                  q.publication,

                revision:
                  q.revision,

                created_at:
                  q.created_at,

                updated_at:
                  q.updated_at,
              }),
            ),
        });
      },
    ),
  );

  /*
   * Create a private or explicitly-public question.
   *
   * Existing Stage12/22 clients remain compatible because all
   * Stage23 fields are optional.
   */
  r.post(
    '/api/v2/questions',
    endpoint(
      async (
        req,
        res,
      ) => {
        const u =
            await principal(
              req,
            ),

          d =
            z
              .object({
                request_key:
                  uuid,

                question:
                  z
                    .string()
                    .trim()
                    .min(3)
                    .max(
                      12000,
                    ),

                title:
                  z
                    .string()
                    .trim()
                    .max(
                      180,
                    )
                    .default(
                      '',
                    ),

                category_id:
                  uuid.optional(),

                tags:
                  z
                    .array(
                      tagSchema,
                    )
                    .max(8)
                    .default(
                      [],
                    ),

                language:
                  languageCode
                    .default(
                      'und',
                    ),

                visibility:
                  z
                    .enum([
                      'PRIVATE',
                      'PUBLIC',
                      'ANONYMOUS',
                    ])
                    .default(
                      'PRIVATE',
                    ),
              })
              .strict()
              .parse(
                req.body,
              );

        await validateMetadata(
          d.category_id,
          d.language,
        );

        const id =
          randomUUID();

        const publicMode =
          d.visibility !==
          'PRIVATE';

        const q =
          (
            await pool.query(
              `
              INSERT INTO questions(
                id,
                owner_id,
                owner_code,
                sealed_question,
                visibility,
                public_question,
                publication,
                request_key,
                title,
                category_id,
                tags,
                language
              )
              VALUES(
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
              )

              ON CONFLICT(owner_id,request_key)
              DO UPDATE
              SET request_key=EXCLUDED.request_key

              RETURNING *
              `,
              [
                id,
                u.id,
                u.public_id,
                seal(
                  d.question,
                  id,
                ),
                d.visibility,
                publicMode
                  ? d.question
                  : null,
                publicMode
                  ? 'PENDING'
                  : 'PRIVATE',
                d.request_key,
                d.title ||
                  null,
                d.category_id ??
                  null,
                d.tags,
                d.language,
              ],
            )
          ).rows[0] as
            QuestionRow;

        if (
          open(
            q.sealed_question,
            q.id,
          ) !==
          d.question ||
          (
            q.title ??
            ''
          ) !==
            d.title ||
          q.language !==
            d.language
        )
          throw new ServiceError(
            409,
            'IDEMPOTENCY_CONFLICT',
          );

        if (
          publicMode
        )
          await pool.query(
            `
            INSERT INTO question_audit(
              question_id,
              actor_id,
              action
            )
            VALUES(
              $1,$2,
              'OWNER_PUBLICATION_CONSENT'
            )
            `,
            [
              q.id,
              u.id,
            ],
          );

        res.json({
          data: {
            id:
              q.id,

            revision:
              q.revision,

            publication:
              q.publication,
          },
        });
      },
    ),
  );

  /*
   * Legacy single-answer route remains supported.
   */
  r.post(
    '/api/v2/questions/:id/answer',
    endpoint(
      async (
        req,
        res,
      ) => {
        const u =
            await principal(
              req,
            ),

          id =
            uuid.parse(
              req.params.id,
            ),

          d =
            z
              .object({
                answer:
                  z
                    .string()
                    .trim()
                    .min(1)
                    .max(
                      20000,
                    ),

                revision:
                  z
                    .number()
                    .int()
                    .positive(),
              })
              .strict()
              .parse(
                req.body,
              );

        const result =
          await pool.query(
            `
            UPDATE questions
            SET
              sealed_answer=$3,

              publication=
                CASE
                  WHEN publication='PUBLISHED'
                  THEN 'PUBLISHED'

                  WHEN visibility='PRIVATE'
                  THEN 'PRIVATE'

                  ELSE 'PENDING'
                END,

              revision=revision+1,
              updated_at=now()

            WHERE id=$1
              AND expert_id=$2
              AND revision=$4

            RETURNING revision
            `,
            [
              id,
              u.id,
              seal(
                d.answer,
                id +
                  ':answer',
              ),
              d.revision,
            ],
          );

        if (
          !result.rowCount
        )
          throw new ServiceError(
            409,
            'CONFLICT',
          );

        res.json({
          data:
            result.rows[0],
        });
      },
    ),
  );

  /*
   * Multiple answers.
   *
   * Only the assigned expert may answer.
   */
  r.post(
    '/api/v2/questions/:id/answers',
    endpoint(
      async (
        req,
        res,
      ) => {
        const u =
            await principal(
              req,
            ),

          id =
            uuid.parse(
              req.params.id,
            ),

          d =
            z
              .object({
                body:
                  z
                    .string()
                    .trim()
                    .min(1)
                    .max(
                      20000,
                    ),

                public_body:
                  z
                    .string()
                    .trim()
                    .max(
                      20000,
                    )
                    .optional(),
              })
              .strict()
              .parse(
                req.body,
              );

        const answerId =
          randomUUID();

        await transaction(
          pool,
          async (
            db,
          ) => {
            const q =
              (
                await db.query(
                  `
                  SELECT *
                  FROM questions
                  WHERE id=$1
                  FOR UPDATE
                  `,
                  [
                    id,
                  ],
                )
              ).rows[0] as
                | QuestionRow
                | undefined;

            if (
              !q
            )
              throw new ServiceError(
                404,
                'NOT_FOUND',
              );

            if (
              q.expert_id !==
              u.id
            )
              throw new ServiceError(
                403,
                'FORBIDDEN',
              );

            const publicBody =
              q.visibility !==
                'PRIVATE'
                ? (
                    d.public_body ??
                    d.body
                  )
                : null;

            const publication =
              q.visibility ===
              'PRIVATE'
                ? 'PRIVATE'
                : q.publication ===
                    'PUBLISHED'
                  ? 'PUBLISHED'
                  : 'PENDING';

            await db.query(
              `
              INSERT INTO question_answers(
                id,
                question_id,
                author_id,
                author_code,
                sealed_body,
                public_body,
                publication
              )
              VALUES(
                $1,$2,$3,$4,$5,$6,$7
              )
              `,
              [
                answerId,
                id,
                u.id,
                u.public_id,
                seal(
                  d.body,
                  'answer:' +
                    answerId,
                ),
                publicBody,
                publication,
              ],
            );

            await db.query(
              `
              UPDATE questions
              SET
                sealed_answer=$2,
                public_answer=
                  CASE
                    WHEN $3='PUBLISHED'
                    THEN $4
                    ELSE public_answer
                  END,
                revision=revision+1,
                updated_at=now()
              WHERE id=$1
              `,
              [
                id,
                seal(
                  d.body,
                  id +
                    ':answer',
                ),
                publication,
                publicBody,
              ],
            );

            await db.query(
              `
              INSERT INTO question_audit(
                question_id,
                actor_id,
                action
              )
              VALUES(
                $1,$2,
                'ANSWER_CREATED'
              )
              `,
              [
                id,
                u.id,
              ],
            );
          },
        );

        res.status(
          201,
        ).json({
          data: {
            id:
              answerId,
          },
        });
      },
    ),
  );

  /*
   * Authenticated answer history.
   */
  r.get(
    '/api/v2/questions/:id/answers',
    endpoint(
      async (
        req,
        res,
      ) => {
        const u =
            await principal(
              req,
            ),

          id =
            uuid.parse(
              req.params.id,
            );

        const q =
          await question(
            pool,
            id,
          );

        if (
          !q
        )
          throw new ServiceError(
            404,
            'NOT_FOUND',
          );

        if (
          ![
            q.owner_id,
            q.expert_id,
          ].includes(
            u.id,
          )
        )
          throw new ServiceError(
            403,
            'FORBIDDEN',
          );

        const rows =
          (
            await pool.query(
              `
              SELECT *
              FROM question_answers
              WHERE question_id=$1
              ORDER BY created_at,id
              `,
              [
                id,
              ],
            )
          ).rows as
            AnswerRow[];

        res.json({
          data:
            rows.map(
              (
                answer,
              ) => ({
                id:
                  answer.id,

                body:
                  answerBody(
                    answer,
                  ),

                public_body:
                  answer.public_body,

                publication:
                  answer.publication,

                author_code:
                  answer.author_code,

                accepted:
                  q.accepted_answer_id ===
                  answer.id,

                created_at:
                  answer.created_at,
              }),
            ),
        });
      },
    ),
  );

  /*
   * Only the question owner can accept an answer.
   */
  r.post(
    '/api/v2/questions/:id/answers/:answer/accept',
    endpoint(
      async (
        req,
        res,
      ) => {
        const u =
            await principal(
              req,
            ),

          id =
            uuid.parse(
              req.params.id,
            ),

          answerId =
            uuid.parse(
              req.params.answer,
            );

        await transaction(
          pool,
          async (
            db,
          ) => {
            const q =
              (
                await db.query(
                  `
                  SELECT *
                  FROM questions
                  WHERE id=$1
                  FOR UPDATE
                  `,
                  [
                    id,
                  ],
                )
              ).rows[0] as
                | QuestionRow
                | undefined;

            if (
              !q
            )
              throw new ServiceError(
                404,
                'NOT_FOUND',
              );

            if (
              q.owner_id !==
              u.id
            )
              throw new ServiceError(
                403,
                'FORBIDDEN',
              );

            const answer =
              (
                await db.query(
                  `
                  SELECT *
                  FROM question_answers
                  WHERE id=$1
                    AND question_id=$2
                  `,
                  [
                    answerId,
                    id,
                  ],
                )
              ).rows[0] as
                | AnswerRow
                | undefined;

            if (
              !answer
            )
              throw new ServiceError(
                404,
                'NOT_FOUND',
              );

            const plain =
              answerBody(
                answer,
              );

            await db.query(
              `
              UPDATE questions
              SET
                accepted_answer_id=$2,
                sealed_answer=$3,
                public_answer=
                  CASE
                    WHEN $4='PUBLISHED'
                    THEN $5
                    ELSE public_answer
                  END,
                revision=revision+1,
                updated_at=now()
              WHERE id=$1
              `,
              [
                id,
                answerId,
                seal(
                  plain,
                  id +
                    ':answer',
                ),
                answer.publication,
                answer.public_body,
              ],
            );

            await db.query(
              `
              INSERT INTO question_audit(
                question_id,
                actor_id,
                action
              )
              VALUES(
                $1,$2,
                'ANSWER_ACCEPTED'
              )
              `,
              [
                id,
                u.id,
              ],
            );
          },
        );

        res.json({
          data: {
            ok:
              true,
          },
        });
      },
    ),
  );

  /*
   * Public comments.
   *
   * Comments are explicitly public and therefore store their
   * public body directly.
   */
  r.post(
    '/api/v2/questions/:id/comments',
    endpoint(
      async (
        req,
        res,
      ) => {
        const u =
            await principal(
              req,
            ),

          id =
            uuid.parse(
              req.params.id,
            ),

          d =
            z
              .object({
                body:
                  z
                    .string()
                    .trim()
                    .min(1)
                    .max(
                      3000,
                    ),

                answer_id:
                  uuid.optional(),
              })
              .strict()
              .parse(
                req.body,
              );

        const q =
          await question(
            pool,
            id,
          );

        if (
          !q ||
          q.publication !==
            'PUBLISHED' ||
          ![
            'PUBLIC',
            'ANONYMOUS',
          ].includes(
            q.visibility,
          )
        )
          throw new ServiceError(
            404,
            'NOT_FOUND',
          );

        if (
          d.answer_id
        ) {
          const answer =
            (
              await pool.query(
                `
                SELECT id
                FROM question_answers
                WHERE id=$1
                  AND question_id=$2
                  AND publication='PUBLISHED'
                `,
                [
                  d.answer_id,
                  id,
                ],
              )
            ).rows[0];

          if (
            !answer
          )
            throw new ServiceError(
              404,
              'NOT_FOUND',
            );
        }

        const commentId =
          randomUUID();

        await pool.query(
          `
          INSERT INTO question_comments(
            id,
            question_id,
            answer_id,
            author_id,
            author_code,
            body
          )
          VALUES(
            $1,$2,$3,$4,$5,$6
          )
          `,
          [
            commentId,
            id,
            d.answer_id ??
              null,
            u.id,
            u.public_id,
            d.body,
          ],
        );

        await pool.query(
          `
          UPDATE questions
          SET updated_at=now()
          WHERE id=$1
          `,
          [
            id,
          ],
        );

        res.status(
          201,
        ).json({
          data: {
            id:
              commentId,
          },
        });
      },
    ),
  );

  /*
   * Owner-controlled public/private publication settings.
   *
   * Public question copy is sufficient for publication.
   * Public answer may be added later, allowing real
   * unanswered public questions.
   */
  r.post(
    '/api/v2/questions/:id/visibility',
    endpoint(
      async (
        req,
        res,
      ) => {
        const u =
            await principal(
              req,
            ),

          id =
            uuid.parse(
              req.params.id,
            ),

          d =
            z
              .object({
                visibility:
                  z.enum([
                    'PRIVATE',
                    'PUBLIC',
                    'ANONYMOUS',
                  ]),

                public_question:
                  z
                    .string()
                    .trim()
                    .max(
                      12000,
                    )
                    .default(
                      '',
                    ),

                public_answer:
                  z
                    .string()
                    .trim()
                    .max(
                      20000,
                    )
                    .default(
                      '',
                    ),

                revision:
                  z
                    .number()
                    .int()
                    .positive(),
              })
              .strict()
              .parse(
                req.body,
              );

        if (
          d.visibility !==
            'PRIVATE' &&
          !d.public_question
        )
          throw new ServiceError(
            400,
            'PUBLIC_COPY_REQUIRED',
          );

        const q =
          await pool.query(
            `
            UPDATE questions
            SET
              visibility=$3,
              public_question=$4,
              public_answer=$5,
              publication=
                CASE
                  WHEN $3='PRIVATE'
                  THEN 'PRIVATE'
                  ELSE 'PENDING'
                END,
              revision=revision+1,
              updated_at=now()

            WHERE id=$1
              AND owner_id=$2
              AND revision=$6

            RETURNING revision
            `,
            [
              id,
              u.id,
              d.visibility,
              d.visibility ===
                'PRIVATE'
                ? null
                : d.public_question,
              d.visibility ===
                'PRIVATE' ||
              !d.public_answer
                ? null
                : d.public_answer,
              d.revision,
            ],
          );

        if (
          !q.rowCount
        )
          throw new ServiceError(
            409,
            'CONFLICT',
          );

        await pool.query(
          `
          INSERT INTO question_audit(
            question_id,
            actor_id,
            action
          )
          VALUES(
            $1,$2,
            'OWNER_PUBLICATION_CONSENT'
          )
          `,
          [
            id,
            u.id,
          ],
        );

        res.json({
          data:
            q.rows[0],
        });
      },
    ),
  );

  /*
   * Stored translation.
   *
   * Stage7 may automate population later.
   * Work23.2 never invents translated content.
   */
  r.post(
    '/api/v2/questions/:id/translation',
    endpoint(
      async (
        req,
        res,
      ) => {
        const u =
            await requirePermission(
              req,
              'question.manage',
            ),

          id =
            uuid.parse(
              req.params.id,
            ),

          d =
            z
              .object({
                language:
                  languageCode,

                title:
                  z
                    .string()
                    .trim()
                    .min(1)
                    .max(
                      180,
                    ),

                question:
                  z
                    .string()
                    .trim()
                    .min(1)
                    .max(
                      12000,
                    ),

                accepted_answer:
                  z
                    .string()
                    .trim()
                    .max(
                      20000,
                    )
                    .optional(),
              })
              .strict()
              .parse(
                req.body,
              );

        const q =
          await question(
            pool,
            id,
          );

        if (
          !q
        )
          throw new ServiceError(
            404,
            'NOT_FOUND',
          );

        await pool.query(
          `
          INSERT INTO question_translations(
            question_id,
            language,
            title,
            question,
            accepted_answer
          )
          VALUES(
            $1,$2,$3,$4,$5
          )

          ON CONFLICT(question_id,language)
          DO UPDATE SET
            title=$3,
            question=$4,
            accepted_answer=$5,
            updated_at=now()
          `,
          [
            id,
            d.language,
            d.title,
            d.question,
            d.accepted_answer ??
              null,
          ],
        );

        await pool.query(
          `
          INSERT INTO question_audit(
            question_id,
            actor_id,
            action
          )
          VALUES(
            $1,$2,
            'TRANSLATION_SAVED'
          )
          `,
          [
            id,
            u.id,
          ],
        );

        res.json({
          data: {
            ok:
              true,
          },
        });
      },
    ),
  );

  r.get(
    '/api/v2/questions/admin',
    endpoint(
      async (
        req,
        res,
      ) => {
        await requirePermission(
          req,
          'question.manage',
        );

        res.json({
          data:
            (
              await pool.query(
                `
                SELECT
                  id,
                  owner_code,
                  expert_id,
                  visibility,
                  publication,
                  public_question,
                  public_answer,
                  title,
                  category_id,
                  tags,
                  language,
                  views,
                  accepted_answer_id,
                  revision,
                  created_at,
                  updated_at
                FROM questions
                ORDER BY updated_at DESC
                LIMIT 100
                `,
              )
            ).rows,
        });
      },
    ),
  );

  r.post(
    '/api/v2/questions/:id/assign',
    endpoint(
      async (
        req,
        res,
      ) => {
        const u =
            await requirePermission(
              req,
              'question.manage',
            ),

          id =
            uuid.parse(
              req.params.id,
            ),

          d =
            z
              .object({
                expert:
                  z
                    .string()
                    .regex(
                      /^[A-Za-z0-9]{13}$/,
                    ),

                revision:
                  z
                    .number()
                    .int()
                    .positive(),
              })
              .strict()
              .parse(
                req.body,
              ),

          expert =
            await internalCall<{
              account_id:
                string;
            }>(
              'scholar-service',
              '/internal/communications/expert/' +
                d.expert,
              req.get(
                'authorization',
              ) ??
                '',
            );

        await transaction(
          pool,
          async (
            db,
          ) => {
            const q =
              (
                await db.query(
                  `
                  SELECT *
                  FROM questions
                  WHERE id=$1
                  FOR UPDATE
                  `,
                  [
                    id,
                  ],
                )
              ).rows[0];

            if (
              !q
            )
              throw new ServiceError(
                404,
                'NOT_FOUND',
              );

            if (
              q.revision !==
                d.revision ||
              q.expert_id
            )
              throw new ServiceError(
                409,
                'CONFLICT',
              );

            await db.query(
              `
              UPDATE questions
              SET
                expert_id=$2,
                revision=revision+1,
                updated_at=now()
              WHERE id=$1
              `,
              [
                id,
                expert.account_id,
              ],
            );

            await db.query(
              `
              INSERT INTO question_audit(
                question_id,
                actor_id,
                action
              )
              VALUES(
                $1,$2,
                'ASSIGNED'
              )
              `,
              [
                id,
                u.id,
              ],
            );
          },
        );

        res.json({
          data: {
            ok:
              true,
          },
        });
      },
    ),
  );

  /*
   * Question publication moderation.
   *
   * A question may now be published before an answer exists,
   * enabling the real "Unanswered" feed.
   */
  r.post(
    '/api/v2/questions/:id/review',
    endpoint(
      async (
        req,
        res,
      ) => {
        const u =
            await requirePermission(
              req,
              'question.manage',
            ),

          id =
            uuid.parse(
              req.params.id,
            ),

          d =
            z
              .object({
                publish:
                  z.boolean(),

                revision:
                  z
                    .number()
                    .int()
                    .positive(),
              })
              .strict()
              .parse(
                req.body,
              );

        await transaction(
          pool,
          async (
            db,
          ) => {
            const q =
              await db.query(
                `
                UPDATE questions
                SET
                  publication=$3,
                  revision=revision+1,
                  updated_at=now()

                WHERE id=$1
                  AND revision=$2
                  AND visibility<>'PRIVATE'
                  AND publication='PENDING'
                  AND public_question IS NOT NULL

                RETURNING id
                `,
                [
                  id,
                  d.revision,
                  d.publish
                    ? 'PUBLISHED'
                    : 'REJECTED',
                ],
              );

            if (
              !q.rowCount
            )
              throw new ServiceError(
                409,
                'CONFLICT',
              );

            if (
              d.publish
            )
              await db.query(
                `
                UPDATE question_answers
                SET
                  publication='PUBLISHED',
                  updated_at=now()
                WHERE question_id=$1
                  AND publication='PENDING'
                  AND public_body IS NOT NULL
                `,
                [
                  id,
                ],
              );

            await db.query(
              `
              INSERT INTO question_audit(
                question_id,
                actor_id,
                action
              )
              VALUES(
                $1,$2,$3
              )
              `,
              [
                id,
                u.id,
                d.publish
                  ? 'PUBLISHED'
                  : 'REJECTED',
              ],
            );
          },
        );

        res.json({
          data: {
            ok:
              true,
          },
        });
      },
    ),
  );

  /*
   * Existing question-private-thread integration.
   */
  r.get(
    '/internal/questions/:id/context',
    endpoint(
      async (
        req,
        res,
      ) => {
        const u =
            await principal(
              req,
            ),

          q =
            (
              await pool.query(
                `
                SELECT
                  owner_id,
                  expert_id
                FROM questions
                WHERE id=$1
                `,
                [
                  uuid.parse(
                    req.params.id,
                  ),
                ],
              )
            ).rows[0];

        if (
          !q ||
          !q.expert_id ||
          ![
            q.owner_id,
            q.expert_id,
          ].includes(
            u.id,
          )
        )
          throw new ServiceError(
            403,
            'FORBIDDEN',
          );

        res.json({
          data:
            q,
        });
      },
    ),
  );

  r.post(
    '/api/v2/questions/:id/conversation',
    endpoint(
      async (
        req,
        res,
      ) => {
        await principal(
          req,
        );

        res.json({
          data:
            await internalCall(
              'messaging-service',
              '/internal/communications/question',
              req.get(
                'authorization',
              ) ??
                '',
              {
                question_id:
                  uuid.parse(
                    req.params.id,
                  ),
              },
            ),
        });
      },
    ),
  );

  return r;
}
