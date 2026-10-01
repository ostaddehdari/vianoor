import {
  randomUUID,
} from 'node:crypto';

import type {
  Pool,
  PoolClient,
} from 'pg';

import {
  z,
} from 'zod';

import {
  bootstrap,
  connectInfrastructure,
  createService,
  endpoint,
  internalCall,
  internalRouter,
  principal,
  readRuntimeConfig,
  ServiceError,
} from '@vianoor/service-runtime';

const uuid =
  z.string().uuid();

const caseKind =
  z.enum([
    'TICKET',
    'COMPLAINT',
  ]);

const caseStatus =
  z.enum([
    'OPEN',
    'IN_PROGRESS',
    'RESOLVED',
    'CLOSED',
  ]);

async function audit(
  db:
    | Pool
    | PoolClient,
  caseId: string,
  actorId:
    | string
    | null,
  action: string,
  details:
    Record<
      string,
      unknown
    > = {},
) {
  await db.query(
    `
    INSERT INTO support_case_audit(
      case_id,
      actor_id,
      action,
      details
    )
    VALUES(
      $1,$2,$3,$4
    )
    `,
    [
      caseId,
      actorId,
      action,
      details,
    ],
  );
}

async function authorize(
  req: Parameters<
    typeof principal
  >[0],
  permission: string,
) {
  return internalCall(
    'organization-service',
    '/internal/authorize',
    req.get(
      'authorization',
    ) ??
      '',
    {
      permission,
      scope:
        'platform',
    },
  );
}

async function authorizeOperator(
  req: Parameters<
    typeof principal
  >[0],
) {
  try {
    await authorize(
      req,
      'ticket.assign',
    );

    return;
  } catch (
    first
  ) {
    try {
      await authorize(
        req,
        'call.answer',
      );

      return;
    } catch {
      throw first;
    }
  }
}

async function initialize(
  pool: Pool,
) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_cases(
      id uuid PRIMARY KEY,

      account_id uuid NOT NULL,

      account_code varchar(13) NOT NULL,

      instant_request_id uuid,

      kind text NOT NULL
        CHECK(kind IN(
          'TICKET',
          'COMPLAINT'
        )),

      subject varchar(180) NOT NULL,

      message text NOT NULL,

      status text NOT NULL
        DEFAULT 'OPEN'
        CHECK(status IN(
          'OPEN',
          'IN_PROGRESS',
          'RESOLVED',
          'CLOSED'
        )),

      assigned_to uuid,

      operator_note text NOT NULL
        DEFAULT '',

      created_at timestamptz NOT NULL
        DEFAULT now(),

      updated_at timestamptz NOT NULL
        DEFAULT now(),

      resolved_at timestamptz
    );

    CREATE INDEX IF NOT EXISTS support_cases_owner
      ON support_cases(
        account_id,
        created_at DESC
      );

    CREATE INDEX IF NOT EXISTS support_cases_work
      ON support_cases(
        status,
        kind,
        created_at
      );

    CREATE TABLE IF NOT EXISTS support_case_audit(
      id bigserial PRIMARY KEY,

      case_id uuid NOT NULL
        REFERENCES support_cases(id)
        ON DELETE CASCADE,

      actor_id uuid,

      action text NOT NULL,

      details jsonb NOT NULL
        DEFAULT '{}',

      created_at timestamptz NOT NULL
        DEFAULT now()
    );
  `);
}

function router(
  pool: Pool,
) {
  const r =
    internalRouter(
      '512kb',
    );

  r.post(
    '/api/v2/support/cases',
    endpoint(
      async (
        req,
        res,
      ) => {
        const user =
            await principal(
              req,
            ),

          input =
            z
              .object({
                kind:
                  caseKind,

                subject:
                  z
                    .string()
                    .trim()
                    .min(3)
                    .max(180),

                message:
                  z
                    .string()
                    .trim()
                    .min(5)
                    .max(8000),

                instant_request_id:
                  uuid
                    .nullable()
                    .default(
                      null,
                    ),
              })
              .strict()
              .parse(
                req.body,
              );

        if (
          input.instant_request_id
        )
          await internalCall(
            'instant-service',
            '/internal/instant/' +
              input.instant_request_id +
              '/support-authorize',
            '',
            {
              account_id:
                user.id,
            },
          );

        const id =
          randomUUID();

        const row =
          (
            await pool.query(
              `
              INSERT INTO support_cases(
                id,
                account_id,
                account_code,
                instant_request_id,
                kind,
                subject,
                message
              )
              VALUES(
                $1,$2,$3,$4,$5,$6,$7
              )
              RETURNING *
              `,
              [
                id,
                user.id,
                user.public_id,
                input.instant_request_id,
                input.kind,
                input.subject,
                input.message,
              ],
            )
          ).rows[0];

        await audit(
          pool,
          id,
          user.id,
          'CREATED',
          {
            kind:
              input.kind,
          },
        );

        res.status(
          201,
        ).json({
          data:
            row,
        });
      },
    ),
  );

  r.get(
    '/api/v2/support/cases/mine',
    endpoint(
      async (
        req,
        res,
      ) => {
        const user =
          await principal(
            req,
          );

        res.json({
          data:
            (
              await pool.query(
                `
                SELECT *
                FROM support_cases
                WHERE account_id=$1
                ORDER BY created_at DESC
                LIMIT 100
                `,
                [
                  user.id,
                ],
              )
            ).rows,
        });
      },
    ),
  );

  r.get(
    '/api/v2/support/operator/cases',
    endpoint(
      async (
        req,
        res,
      ) => {
        await authorizeOperator(
          req,
        );

        const query =
          z
            .object({
              kind:
                caseKind.optional(),

              status:
                caseStatus.optional(),
            })
            .strict()
            .parse(
              req.query,
            );

        res.json({
          data:
            (
              await pool.query(
                `
                SELECT *
                FROM support_cases

                WHERE (
                  $1::text IS NULL
                  OR kind=$1
                )
                  AND (
                    $2::text IS NULL
                    OR status=$2
                  )

                ORDER BY
                  CASE status
                    WHEN 'OPEN'
                    THEN 0
                    WHEN 'IN_PROGRESS'
                    THEN 1
                    ELSE 2
                  END,
                  created_at

                LIMIT 300
                `,
                [
                  query.kind ??
                    null,

                  query.status ??
                    null,
                ],
              )
            ).rows,
        });
      },
    ),
  );

  r.patch(
    '/api/v2/support/operator/cases/:id',
    endpoint(
      async (
        req,
        res,
      ) => {
        const operator =
            await principal(
              req,
            );

        await authorizeOperator(
          req,
        );

        const id =
            uuid.parse(
              req.params.id,
            ),

          input =
            z
              .object({
                status:
                  caseStatus,

                operator_note:
                  z
                    .string()
                    .trim()
                    .max(8000)
                    .default(''),
              })
              .strict()
              .parse(
                req.body,
              );

        const row =
          (
            await pool.query(
              `
              UPDATE support_cases
              SET
                status=$2,
                assigned_to=
                  COALESCE(
                    assigned_to,
                    $3
                  ),
                operator_note=$4,
                resolved_at=
                  CASE
                    WHEN $2 IN(
                      'RESOLVED',
                      'CLOSED'
                    )
                    THEN COALESCE(
                      resolved_at,
                      now()
                    )
                    ELSE NULL
                  END,
                updated_at=now()

              WHERE id=$1

              RETURNING *
              `,
              [
                id,
                input.status,
                operator.id,
                input.operator_note,
              ],
            )
          ).rows[0];

        if (!row)
          throw new ServiceError(
            404,
            'NOT_FOUND',
          );

        await audit(
          pool,
          id,
          operator.id,
          'STATUS_UPDATED',
          {
            status:
              input.status,
          },
        );

        res.json({
          data:
            row,
        });
      },
    ),
  );

  return r;
}

if (
  process.env.SUPPORT_ENABLED !==
  '1'
) {
  await bootstrap(
    'support-service',
    4129,
  );
} else {
  const infra =
    await connectInfrastructure(
      'support-service',
    );

  await initialize(
    infra.pool!,
  );

  const app =
      await createService(
        'support-service',
        {
          infrastructure:
            infra,

          ready:
            infra.healthy,

          configure:
            application => {
              application.use(
                router(
                  infra.pool!,
                ),
              );
            },
        },
      ),

    config =
      readRuntimeConfig(
        4129,
      );

  await app.listen(
    config.port,
    config.host,
  );
}
