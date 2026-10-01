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
  endpoint,
  internalCall,
  internalRouter,
  principal,
  requirePermission,
  ServiceError,
  transaction,
} from '@vianoor/service-runtime';

const uuid =
  z.string().uuid();

const code =
  z
    .string()
    .regex(
      /^[A-Za-z0-9]{13}$/,
    );

const utc =
  z
    .string()
    .datetime({
      offset:
        false,
    });

const language =
  z
    .string()
    .regex(
      /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/,
    )
    .max(35);

const currency =
  z
    .string()
    .regex(
      /^[A-Z]{3,6}$/,
    );

const eventInput =
  z
    .object({
      title:
        z
          .string()
          .trim()
          .min(3)
          .max(180),

      description:
        z
          .string()
          .trim()
          .max(12000)
          .default(''),

      language,

      starts_at:
        utc,

      ends_at:
        utc,

      timezone:
        z
          .string()
          .trim()
          .min(1)
          .max(100),

      capacity:
        z
          .number()
          .int()
          .min(2)
          .max(1000),

      price_minor:
        z
          .string()
          .regex(
            /^[0-9]{1,16}$/,
          )
          .default('0'),

      currency:
        currency.default(
          'USD',
        ),

      public:
        z
          .boolean()
          .default(true),

      chat_enabled:
        z
          .boolean()
          .default(true),

      qna_enabled:
        z
          .boolean()
          .default(true),

      raise_hand_enabled:
        z
          .boolean()
          .default(true),

      image_id:
        uuid
          .nullable()
          .default(null),
    })
    .strict()
    .superRefine(
      (
        value,
        context,
      ) => {
        if (
          Date.parse(
            value.ends_at,
          ) <=
          Date.parse(
            value.starts_at,
          )
        )
          context.addIssue({
            code:
              'custom',

            message:
              'INVALID_TIME_RANGE',
          });

        if (
          Date.parse(
            value.starts_at,
          ) <=
          Date.now()
        )
          context.addIssue({
            code:
              'custom',

            message:
              'START_MUST_BE_FUTURE',
          });
      },
    );

type Principal = {
  id: string;
  public_id: string;
  email: string;
};

type Webinar = {
  id: string;
  presenter_id: string;
  presenter_code: string;
  sponsor_id: string | null;
  sponsor_code: string | null;
  source: string;
  status: string;
  title: string;
  description: string;
  language: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  capacity: number;
  price_minor: string;
  currency: string;
  public: boolean;
  chat_enabled: boolean;
  qna_enabled: boolean;
  raise_hand_enabled: boolean;
  image_id: string | null;
  created_by: string;
  request_key: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

type Registration = {
  id: string;
  webinar_id: string;
  account_id: string;
  account_code: string;
  role: string;
  status: string;
  payment_id: string | null;
  hold_expires_at: string | null;
  media_identity: string;
  microphone_allowed: boolean;
  camera_allowed: boolean;
  raised_hand: boolean;
  joined_at: string | null;
  created_at: string;
};

async function expert(
  publicId: string,
) {
  const result =
    await internalCall<{
      verified: boolean;
    }>(
      'scholar-service',
      '/internal/experts/qualification/' +
        encodeURIComponent(
          publicId,
        ),
    );

  if (
    !result.verified
  )
    throw new ServiceError(
      403,
      'VERIFIED_EXPERT_REQUIRED',
    );
}

async function account(
  publicId: string,
) {
  const result =
    await internalCall<{
      id: string;
      public_id: string;
      verified_at: string | null;
      disabled_at: string | null;
    }>(
      'identity-service',
      '/internal/accounts/' +
        encodeURIComponent(
          publicId,
        ),
    );

  if (
    !result.verified_at ||
    result.disabled_at
  )
    throw new ServiceError(
      404,
      'ACCOUNT_UNAVAILABLE',
    );

  return result;
}

async function load(
  db:
    | Pool
    | PoolClient,
  id: string,
  lock = false,
) {
  const row =
    (
      await db.query(
        `
        SELECT *
        FROM webinars
        WHERE id=$1
        ${lock ? 'FOR UPDATE' : ''}
        `,
        [
          id,
        ],
      )
    ).rows[0] as
      | Webinar
      | undefined;

  if (
    !row
  )
    throw new ServiceError(
      404,
      'NOT_FOUND',
    );

  return row;
}

async function presenter(
  req: Parameters<
    typeof principal
  >[0],
  row: Webinar,
) {
  const user =
    await principal(
      req,
    );

  if (
    user.id !==
    row.presenter_id
  )
    throw new ServiceError(
      403,
      'FORBIDDEN',
    );

  return user;
}

async function notify(
  accountId: string,
  webinarId: string,
  event: string,
) {
  await internalCall(
    'notification-service',
    '/internal/notifications',
    '',
    {
      id:
        randomUUID(),

      account_id:
        accountId,

      context_id:
        webinarId,

      /*
       * Existing notification preferences do not yet have a
       * dedicated EVENTS bucket. MESSAGES gives invitations
       * and reminders the existing in-app/email delivery path.
       */
      category:
        'MESSAGES',

      event,
    },
  );
}

async function ensureChat(
  row: Webinar,
  accountId: string,
  role: string,
) {
  if (
    !row.chat_enabled
  )
    return null;

  return internalCall<{
    id: string;
  }>(
    'messaging-service',
    '/internal/communications/event',
    '',
    {
      event_id:
        row.id,

      presenter_id:
        row.presenter_id,

      account_id:
        accountId,

      role,
    },
  );
}

async function registration(
  db:
    | Pool
    | PoolClient,
  eventId: string,
  accountId: string,
) {
  return (
    await db.query(
      `
      SELECT *
      FROM webinar_registrations
      WHERE webinar_id=$1
        AND account_id=$2
      `,
      [
        eventId,
        accountId,
      ],
    )
  ).rows[0] as
    | Registration
    | undefined;
}

async function register(
  pool: Pool,
  row: Webinar,
  user: Principal,
  role:
    | 'ATTENDEE'
    | 'SPONSOR'
    | 'MODERATOR' =
      'ATTENDEE',
) {
  const value =
    await transaction(
      pool,
      async (
        db,
      ) => {
        const event =
          await load(
            db,
            row.id,
            true,
          );

        if (
          ![
            'PUBLISHED',
            'LIVE',
          ].includes(
            event.status,
          )
        )
          throw new ServiceError(
            409,
            'EVENT_NOT_OPEN',
          );

        const old =
          await registration(
            db,
            row.id,
            user.id,
          );

        if (
          old &&
          old.status !==
            'CANCELLED'
        )
          return old;

        const reserved =
          Number(
            (
              await db.query(
                `
                SELECT count(*)::int AS count
                FROM webinar_registrations
                WHERE webinar_id=$1
                  AND status IN(
                    'REGISTERED',
                    'PENDING_PAYMENT'
                  )
                  AND role<>'PRESENTER'
                `,
                [
                  row.id,
                ],
              )
            ).rows[0].count,
          );

        if (
          reserved >=
          event.capacity
        )
          throw new ServiceError(
            409,
            'EVENT_FULL',
          );

        const paid =
          BigInt(
            event.price_minor,
          ) >
          0n;

        const status =
          paid
            ? 'PENDING_PAYMENT'
            : 'REGISTERED';

        const hold =
          paid
            ? new Date(
                Date.now() +
                  15 *
                    60 *
                    1000,
              ).toISOString()
            : null;

        const result =
          (
            await db.query(
              `
              INSERT INTO webinar_registrations(
                id,
                webinar_id,
                account_id,
                account_code,
                role,
                status,
                hold_expires_at,
                media_identity
              )
              VALUES(
                $1,$2,$3,$4,$5,$6,$7,$8
              )

              ON CONFLICT(webinar_id,account_id)
              DO UPDATE SET
                role=$5,
                status=$6,
                hold_expires_at=$7,
                media_identity=
                  webinar_registrations.media_identity

              RETURNING *
              `,
              [
                randomUUID(),
                event.id,
                user.id,
                user.public_id,
                role,
                status,
                hold,
                randomUUID(),
              ],
            )
          ).rows[0] as
            Registration;

        await db.query(
          `
          INSERT INTO webinar_audit(
            webinar_id,
            actor_id,
            action,
            details
          )
          VALUES(
            $1,$2,'REGISTERED',$3
          )
          `,
          [
            event.id,
            user.id,
            {
              role,
              status,
            },
          ],
        );

        return result;
      },
    );

  if (
    value.status ===
    'REGISTERED'
  )
    await ensureChat(
      row,
      user.id,
      role,
    );

  return value;
}

async function createWebinar(
  db: PoolClient,
  input: z.infer<
    typeof eventInput
  >,
  presenterUser: {
    id: string;
    public_id: string;
  },
  creatorId: string,
  requestKey: string,
  source: string,
  sponsor:
    | {
        id: string;
        public_id: string;
      }
    | null =
      null,
) {
  const id =
    randomUUID();

  const row =
    (
      await db.query(
        `
        INSERT INTO webinars(
          id,
          presenter_id,
          presenter_code,
          sponsor_id,
          sponsor_code,
          source,
          status,
          title,
          description,
          language,
          starts_at,
          ends_at,
          timezone,
          capacity,
          price_minor,
          currency,
          public,
          chat_enabled,
          qna_enabled,
          raise_hand_enabled,
          image_id,
          created_by,
          request_key
        )
        VALUES(
          $1,$2,$3,$4,$5,$6,
          'DRAFT',
          $7,$8,$9,$10,$11,$12,
          $13,$14,$15,$16,$17,$18,$19,
          $20,$21,$22
        )
        RETURNING *
        `,
        [
          id,
          presenterUser.id,
          presenterUser.public_id,
          sponsor?.id ??
            null,
          sponsor?.public_id ??
            null,
          source,
          input.title,
          input.description,
          input.language,
          input.starts_at,
          input.ends_at,
          input.timezone,
          input.capacity,
          input.price_minor,
          input.currency,
          input.public,
          input.chat_enabled,
          input.qna_enabled,
          input.raise_hand_enabled,
          input.image_id,
          creatorId,
          requestKey,
        ],
      )
    ).rows[0] as
      Webinar;

  await db.query(
    `
    INSERT INTO webinar_registrations(
      id,
      webinar_id,
      account_id,
      account_code,
      role,
      status,
      media_identity,
      microphone_allowed,
      camera_allowed
    )
    VALUES(
      $1,$2,$3,$4,
      'PRESENTER',
      'REGISTERED',
      $5,
      true,
      true
    )
    ON CONFLICT DO NOTHING
    `,
    [
      randomUUID(),
      row.id,
      presenterUser.id,
      presenterUser.public_id,
      randomUUID(),
    ],
  );

  if (
    sponsor &&
    sponsor.id !==
      presenterUser.id
  )
    await db.query(
      `
      INSERT INTO webinar_registrations(
        id,
        webinar_id,
        account_id,
        account_code,
        role,
        status,
        media_identity
      )
      VALUES(
        $1,$2,$3,$4,
        'SPONSOR',
        'REGISTERED',
        $5
      )
      ON CONFLICT DO NOTHING
      `,
      [
        randomUUID(),
        row.id,
        sponsor.id,
        sponsor.public_id,
        randomUUID(),
      ],
    );

  return row;
}

export async function initializeWebinars(
  pool: Pool,
) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS webinars(
      id uuid PRIMARY KEY,
      presenter_id uuid NOT NULL,
      presenter_code varchar(13) NOT NULL,
      sponsor_id uuid,
      sponsor_code varchar(13),
      source text NOT NULL
        CHECK(source IN('EXPERT','SPONSOR')),
      status text NOT NULL
        CHECK(status IN(
          'DRAFT',
          'PUBLISHED',
          'LIVE',
          'COMPLETED',
          'CANCELLED'
        )),
      title text NOT NULL,
      description text NOT NULL DEFAULT '',
      language text NOT NULL,
      starts_at timestamptz NOT NULL,
      ends_at timestamptz NOT NULL,
      timezone text NOT NULL,
      capacity int NOT NULL
        CHECK(capacity BETWEEN 2 AND 1000),
      price_minor numeric(30,0) NOT NULL
        DEFAULT 0
        CHECK(price_minor>=0),
      currency text NOT NULL,
      public boolean NOT NULL DEFAULT true,
      chat_enabled boolean NOT NULL DEFAULT true,
      qna_enabled boolean NOT NULL DEFAULT true,
      raise_hand_enabled boolean NOT NULL DEFAULT true,
      image_id uuid,
      created_by uuid NOT NULL,
      request_key uuid NOT NULL,
      revision int NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(created_by,request_key)
    );

    CREATE INDEX IF NOT EXISTS webinars_public
      ON webinars(status,starts_at);

    CREATE INDEX IF NOT EXISTS webinars_presenter
      ON webinars(presenter_id,starts_at DESC);

    CREATE TABLE IF NOT EXISTS webinar_requests(
      id uuid PRIMARY KEY,
      sponsor_id uuid NOT NULL,
      sponsor_code varchar(13) NOT NULL,
      proposed_expert_id uuid,
      proposed_expert_code varchar(13),
      title text NOT NULL,
      description text NOT NULL DEFAULT '',
      language text NOT NULL,
      proposed_start timestamptz NOT NULL,
      duration_minutes int NOT NULL
        CHECK(duration_minutes BETWEEN 15 AND 480),
      expected_attendees int NOT NULL
        CHECK(expected_attendees BETWEEN 2 AND 1000),
      budget_minor numeric(30,0),
      currency text NOT NULL,
      status text NOT NULL
        CHECK(status IN(
          'PENDING',
          'COUNTERED',
          'ACCEPTED',
          'REJECTED'
        )),
      counter_start timestamptz,
      resulting_event_id uuid
        REFERENCES webinars(id),
      request_key uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(sponsor_id,request_key)
    );

    CREATE TABLE IF NOT EXISTS webinar_invitations(
      id uuid PRIMARY KEY,
      webinar_id uuid NOT NULL
        REFERENCES webinars(id)
        ON DELETE CASCADE,
      invitee_id uuid NOT NULL,
      invitee_code varchar(13) NOT NULL,
      role text NOT NULL DEFAULT 'ATTENDEE'
        CHECK(role IN(
          'ATTENDEE',
          'SPONSOR',
          'MODERATOR'
        )),
      status text NOT NULL DEFAULT 'INVITED'
        CHECK(status IN(
          'INVITED',
          'ACCEPTED',
          'DECLINED',
          'REGISTERED',
          'JOINED'
        )),
      created_at timestamptz NOT NULL DEFAULT now(),
      responded_at timestamptz,
      UNIQUE(webinar_id,invitee_id)
    );

    CREATE TABLE IF NOT EXISTS webinar_registrations(
      id uuid PRIMARY KEY,
      webinar_id uuid NOT NULL
        REFERENCES webinars(id)
        ON DELETE CASCADE,
      account_id uuid NOT NULL,
      account_code varchar(13) NOT NULL,
      role text NOT NULL
        CHECK(role IN(
          'PRESENTER',
          'MODERATOR',
          'SPONSOR',
          'ATTENDEE'
        )),
      status text NOT NULL
        CHECK(status IN(
          'PENDING_PAYMENT',
          'REGISTERED',
          'CANCELLED'
        )),
      payment_id uuid,
      hold_expires_at timestamptz,
      media_identity uuid NOT NULL,
      microphone_allowed boolean NOT NULL DEFAULT false,
      camera_allowed boolean NOT NULL DEFAULT false,
      raised_hand boolean NOT NULL DEFAULT false,
      joined_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(webinar_id,account_id),
      UNIQUE(media_identity)
    );

    CREATE INDEX IF NOT EXISTS webinar_registrations_event
      ON webinar_registrations(webinar_id,status);

    CREATE TABLE IF NOT EXISTS webinar_reminders(
      webinar_id uuid NOT NULL
        REFERENCES webinars(id)
        ON DELETE CASCADE,
      account_id uuid NOT NULL,
      minutes int NOT NULL,
      sent_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(
        webinar_id,
        account_id,
        minutes
      )
    );

    CREATE TABLE IF NOT EXISTS webinar_audit(
      id bigserial PRIMARY KEY,
      webinar_id uuid,
      actor_id uuid,
      action text NOT NULL,
      details jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export function webinarRouter(
  pool: Pool,
) {
  const r =
    internalRouter(
      '256kb',
    );

  r.get(
    '/api/v2/events/public',
    endpoint(
      async (
        req,
        res,
      ) => {
        const query =
          z
            .object({
              language:
                language.optional(),

              offset:
                z.coerce
                  .number()
                  .int()
                  .min(0)
                  .default(0),

              limit:
                z.coerce
                  .number()
                  .int()
                  .min(1)
                  .max(50)
                  .default(20),
            })
            .strict()
            .parse(
              req.query,
            );

        const rows =
          (
            await pool.query(
              `
              SELECT
                w.*,

                (
                  SELECT count(*)::int
                  FROM webinar_registrations r
                  WHERE r.webinar_id=w.id
                    AND r.status='REGISTERED'
                    AND r.role<>'PRESENTER'
                ) AS registered

              FROM webinars w

              WHERE w.public
                AND w.status IN(
                  'PUBLISHED',
                  'LIVE'
                )
                AND w.ends_at>now()
                AND (
                  $1::text IS NULL
                  OR w.language=$1
                )

              ORDER BY
                w.starts_at,
                w.id

              LIMIT $2
              OFFSET $3
              `,
              [
                query.language ??
                  null,
                query.limit,
                query.offset,
              ],
            )
          ).rows;

        res.json({
          data:
            rows.map(
              (
                row,
              ) => ({
                ...row,

                remaining:
                  Math.max(
                    0,
                    Number(
                      row.capacity,
                    ) -
                      Number(
                        row.registered,
                      ),
                  ),
              }),
            ),
        });
      },
    ),
  );

  r.get(
    '/api/v2/events/public/:id',
    endpoint(
      async (
        req,
        res,
      ) => {
        const id =
          uuid.parse(
            req.params.id,
          );

        const row =
          (
            await pool.query(
              `
              SELECT
                w.*,

                (
                  SELECT count(*)::int
                  FROM webinar_registrations r
                  WHERE r.webinar_id=w.id
                    AND r.status='REGISTERED'
                    AND r.role<>'PRESENTER'
                ) AS registered

              FROM webinars w

              WHERE w.id=$1
                AND w.public
                AND w.status IN(
                  'PUBLISHED',
                  'LIVE',
                  'COMPLETED'
                )
              `,
              [
                id,
              ],
            )
          ).rows[0];

        if (
          !row
        )
          throw new ServiceError(
            404,
            'NOT_FOUND',
          );

        res.json({
          data: {
            ...row,

            remaining:
              Math.max(
                0,
                Number(
                  row.capacity,
                ) -
                  Number(
                    row.registered,
                  ),
              ),
          },
        });
      },
    ),
  );

  /*
   * Expert creates a Webinar.
   */
  r.post(
    '/api/v2/events',
    endpoint(
      async (
        req,
        res,
      ) => {
        const user =
            await principal(
              req,
            );

        await expert(
          user.public_id,
        );

        const input =
          z
            .object({
              request_key:
                uuid,

              webinar:
                eventInput,
            })
            .strict()
            .parse(
              req.body,
            );

        const row =
          await transaction(
            pool,
            async (
              db,
            ) => {
              const old =
                (
                  await db.query(
                    `
                    SELECT *
                    FROM webinars
                    WHERE created_by=$1
                      AND request_key=$2
                    `,
                    [
                      user.id,
                      input.request_key,
                    ],
                  )
                ).rows[0] as
                  | Webinar
                  | undefined;

              if (
                old
              )
                return old;

              return createWebinar(
                db,
                input.webinar,
                user,
                user.id,
                input.request_key,
                'EXPERT',
              );
            },
          );

        await ensureChat(
          row,
          user.id,
          'PRESENTER',
        ).catch(
          () => {},
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

  r.put(
    '/api/v2/events/:id',
    endpoint(
      async (
        req,
        res,
      ) => {
        const id =
            uuid.parse(
              req.params.id,
            ),

          current =
            await load(
              pool,
              id,
            ),

          user =
            await presenter(
              req,
              current,
            ),

          input =
            eventInput.parse(
              req.body,
            );

        if (
          ![
            'DRAFT',
            'PUBLISHED',
          ].includes(
            current.status,
          )
        )
          throw new ServiceError(
            409,
            'INVALID_TRANSITION',
          );

        const updated =
          (
            await pool.query(
              `
              UPDATE webinars
              SET
                title=$2,
                description=$3,
                language=$4,
                starts_at=$5,
                ends_at=$6,
                timezone=$7,
                capacity=$8,
                price_minor=$9,
                currency=$10,
                public=$11,
                chat_enabled=$12,
                qna_enabled=$13,
                raise_hand_enabled=$14,
                image_id=$15,
                revision=revision+1,
                updated_at=now()

              WHERE id=$1

              RETURNING *
              `,
              [
                id,
                input.title,
                input.description,
                input.language,
                input.starts_at,
                input.ends_at,
                input.timezone,
                input.capacity,
                input.price_minor,
                input.currency,
                input.public,
                input.chat_enabled,
                input.qna_enabled,
                input.raise_hand_enabled,
                input.image_id,
              ],
            )
          ).rows[0];

        await pool.query(
          `
          INSERT INTO webinar_audit(
            webinar_id,
            actor_id,
            action
          )
          VALUES(
            $1,$2,'UPDATED'
          )
          `,
          [
            id,
            user.id,
          ],
        );

        res.json({
          data:
            updated,
        });
      },
    ),
  );

  r.post(
    '/api/v2/events/:id/publish',
    endpoint(
      async (
        req,
        res,
      ) => {
        const id =
            uuid.parse(
              req.params.id,
            ),

          current =
            await load(
              pool,
              id,
            ),

          user =
            await presenter(
              req,
              current,
            );

        if (
          ![
            'DRAFT',
            'PUBLISHED',
          ].includes(
            current.status,
          )
        )
          throw new ServiceError(
            409,
            'INVALID_TRANSITION',
          );

        if (
          Date.parse(
            current.starts_at,
          ) <=
          Date.now()
        )
          throw new ServiceError(
            409,
            'EVENT_ALREADY_STARTED',
          );

        const updated =
          (
            await pool.query(
              `
              UPDATE webinars
              SET
                status='PUBLISHED',
                revision=revision+1,
                updated_at=now()
              WHERE id=$1
              RETURNING *
              `,
              [
                id,
              ],
            )
          ).rows[0];

        await pool.query(
          `
          INSERT INTO webinar_audit(
            webinar_id,
            actor_id,
            action
          )
          VALUES(
            $1,$2,'PUBLISHED'
          )
          `,
          [
            id,
            user.id,
          ],
        );

        res.json({
          data:
            updated,
        });
      },
    ),
  );

  /*
   * Sponsor requests a Webinar.
   */
  r.post(
    '/api/v2/events/requests',
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
                request_key:
                  uuid,

                proposed_expert:
                  code.optional(),

                title:
                  z
                    .string()
                    .trim()
                    .min(3)
                    .max(180),

                description:
                  z
                    .string()
                    .trim()
                    .max(12000)
                    .default(''),

                language,

                proposed_start:
                  utc,

                duration_minutes:
                  z
                    .number()
                    .int()
                    .min(15)
                    .max(480),

                expected_attendees:
                  z
                    .number()
                    .int()
                    .min(2)
                    .max(1000),

                budget_minor:
                  z
                    .string()
                    .regex(
                      /^[0-9]{1,16}$/,
                    )
                    .optional(),

                currency:
                  currency.default(
                    'USD',
                  ),
              })
              .strict()
              .parse(
                req.body,
              );

        if (
          Date.parse(
            input.proposed_start,
          ) <=
          Date.now()
        )
          throw new ServiceError(
            400,
            'START_MUST_BE_FUTURE',
          );

        let proposed:
          | {
              account_id:
                string;

              expert_code:
                string;
            }
          | null =
            null;

        if (
          input.proposed_expert
        ) {
          const list =
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
                    input.proposed_expert,
                }),
            );

          proposed =
            list[0] ??
            null;

          if (
            !proposed
          )
            throw new ServiceError(
              404,
              'EXPERT_UNAVAILABLE',
            );
        }

        const old =
          (
            await pool.query(
              `
              SELECT *
              FROM webinar_requests
              WHERE sponsor_id=$1
                AND request_key=$2
              `,
              [
                user.id,
                input.request_key,
              ],
            )
          ).rows[0];

        if (
          old
        ) {
          res.json({
            data:
              old,
          });

          return;
        }

        const id =
          randomUUID();

        const row =
          (
            await pool.query(
              `
              INSERT INTO webinar_requests(
                id,
                sponsor_id,
                sponsor_code,
                proposed_expert_id,
                proposed_expert_code,
                title,
                description,
                language,
                proposed_start,
                duration_minutes,
                expected_attendees,
                budget_minor,
                currency,
                status,
                request_key
              )
              VALUES(
                $1,$2,$3,$4,$5,$6,$7,$8,$9,
                $10,$11,$12,$13,'PENDING',$14
              )
              RETURNING *
              `,
              [
                id,
                user.id,
                user.public_id,
                proposed
                  ?.account_id ??
                  null,
                proposed
                  ?.expert_code ??
                  null,
                input.title,
                input.description,
                input.language,
                input.proposed_start,
                input.duration_minutes,
                input.expected_attendees,
                input.budget_minor ??
                  null,
                input.currency,
                input.request_key,
              ],
            )
          ).rows[0];

        if (
          proposed
        )
          await notify(
            proposed.account_id,
            id,
            'WEBINAR_SPONSOR_REQUEST',
          ).catch(
            () => {},
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
    '/api/v2/events/requests/mine',
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
                FROM webinar_requests
                WHERE sponsor_id=$1
                   OR proposed_expert_id=$1
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
    '/api/v2/events/requests/open',
    endpoint(
      async (
        req,
        res,
      ) => {
        const user =
          await principal(
            req,
          );

        await expert(
          user.public_id,
        );

        res.json({
          data:
            (
              await pool.query(
                `
                SELECT *
                FROM webinar_requests
                WHERE proposed_expert_id IS NULL
                  AND status='PENDING'
                  AND proposed_start>now()
                ORDER BY created_at DESC
                LIMIT 100
                `,
              )
            ).rows,
        });
      },
    ),
  );

  r.post(
    '/api/v2/events/requests/:id/respond',
    endpoint(
      async (
        req,
        res,
      ) => {
        const user =
            await principal(
              req,
            );

        await expert(
          user.public_id,
        );

        const id =
            uuid.parse(
              req.params.id,
            ),

          input =
            z
              .object({
                action:
                  z.enum([
                    'ACCEPT',
                    'REJECT',
                    'COUNTER',
                  ]),

                counter_start:
                  utc.optional(),

                webinar:
                  eventInput.optional(),
              })
              .strict()
              .parse(
                req.body,
              );

        const result =
          await transaction(
            pool,
            async (
              db,
            ) => {
              const request =
                (
                  await db.query(
                    `
                    SELECT *
                    FROM webinar_requests
                    WHERE id=$1
                    FOR UPDATE
                    `,
                    [
                      id,
                    ],
                  )
                ).rows[0];

              if (
                !request
              )
                throw new ServiceError(
                  404,
                  'NOT_FOUND',
                );

              if (
                ![
                  'PENDING',
                  'COUNTERED',
                ].includes(
                  request.status,
                )
              )
                throw new ServiceError(
                  409,
                  'INVALID_TRANSITION',
                );

              if (
                request.proposed_expert_id &&
                request.proposed_expert_id !==
                  user.id
              )
                throw new ServiceError(
                  403,
                  'FORBIDDEN',
                );

              if (
                input.action ===
                'REJECT'
              ) {
                await db.query(
                  `
                  UPDATE webinar_requests
                  SET
                    status='REJECTED',
                    proposed_expert_id=
                      COALESCE(
                        proposed_expert_id,
                        $2
                      ),
                    proposed_expert_code=
                      COALESCE(
                        proposed_expert_code,
                        $3
                      ),
                    updated_at=now()
                  WHERE id=$1
                  `,
                  [
                    id,
                    user.id,
                    user.public_id,
                  ],
                );

                return {
                  request_id:
                    id,

                  status:
                    'REJECTED',
                };
              }

              if (
                input.action ===
                'COUNTER'
              ) {
                if (
                  !input.counter_start ||
                  Date.parse(
                    input.counter_start,
                  ) <=
                  Date.now()
                )
                  throw new ServiceError(
                    400,
                    'COUNTER_TIME_REQUIRED',
                  );

                await db.query(
                  `
                  UPDATE webinar_requests
                  SET
                    status='COUNTERED',
                    counter_start=$2,
                    proposed_expert_id=$3,
                    proposed_expert_code=$4,
                    updated_at=now()
                  WHERE id=$1
                  `,
                  [
                    id,
                    input.counter_start,
                    user.id,
                    user.public_id,
                  ],
                );

                return {
                  request_id:
                    id,

                  status:
                    'COUNTERED',
                };
              }

              const start =
                request.counter_start ??
                request.proposed_start;

              const webinar =
                input.webinar ??
                eventInput.parse({
                  title:
                    request.title,

                  description:
                    request.description,

                  language:
                    request.language,

                  starts_at:
                    new Date(
                      start,
                    ).toISOString(),

                  ends_at:
                    new Date(
                      Date.parse(
                        start,
                      ) +
                        Number(
                          request.duration_minutes,
                        ) *
                          60000,
                    ).toISOString(),

                  timezone:
                    'UTC',

                  capacity:
                    Number(
                      request.expected_attendees,
                    ),

                  price_minor:
                    '0',

                  currency:
                    request.currency,

                  public:
                    true,

                  chat_enabled:
                    true,

                  qna_enabled:
                    true,

                  raise_hand_enabled:
                    true,

                  image_id:
                    null,
                });

              const sponsor = {
                id:
                  request.sponsor_id,

                public_id:
                  request.sponsor_code,
              };

              const event =
                await createWebinar(
                  db,
                  webinar,
                  user,
                  request.sponsor_id,
                  randomUUID(),
                  'SPONSOR',
                  sponsor,
                );

              await db.query(
                `
                UPDATE webinar_requests
                SET
                  status='ACCEPTED',
                  proposed_expert_id=$2,
                  proposed_expert_code=$3,
                  resulting_event_id=$4,
                  updated_at=now()
                WHERE id=$1
                `,
                [
                  id,
                  user.id,
                  user.public_id,
                  event.id,
                ],
              );

              return {
                request_id:
                  id,

                status:
                  'ACCEPTED',

                event,
              };
            },
          );

        const event =
          'event' in result
            ? result.event
            : null;

        if (
          event
        ) {
          await ensureChat(
            event,
            event.presenter_id,
            'PRESENTER',
          ).catch(
            () => {},
          );

          if (
            event.sponsor_id
          )
            await ensureChat(
              event,
              event.sponsor_id,
              'SPONSOR',
            ).catch(
              () => {},
            );
        }

        res.json({
          data:
            result,
        });
      },
    ),
  );

  /*
   * Invitations.
   */
  r.post(
    '/api/v2/events/:id/invitations',
    endpoint(
      async (
        req,
        res,
      ) => {
        const row =
            await load(
              pool,
              uuid.parse(
                req.params.id,
              ),
            ),

          user =
            await presenter(
              req,
              row,
            ),

          input =
            z
              .object({
                invitees:
                  z
                    .array(
                      code,
                    )
                    .min(1)
                    .max(100),

                role:
                  z
                    .enum([
                      'ATTENDEE',
                      'MODERATOR',
                    ])
                    .default(
                      'ATTENDEE',
                    ),
              })
              .strict()
              .parse(
                req.body,
              );

        const created:
          unknown[] = [];

        for (
          const publicId
          of [
            ...new Set(
              input.invitees,
            ),
          ]
        ) {
          const target =
            await account(
              publicId,
            );

          if (
            target.id ===
            row.presenter_id
          )
            continue;

          const invitation =
            (
              await pool.query(
                `
                INSERT INTO webinar_invitations(
                  id,
                  webinar_id,
                  invitee_id,
                  invitee_code,
                  role
                )
                VALUES(
                  $1,$2,$3,$4,$5
                )

                ON CONFLICT(webinar_id,invitee_id)
                DO UPDATE SET
                  role=$5,
                  status=
                    CASE
                      WHEN webinar_invitations.status='DECLINED'
                      THEN 'INVITED'
                      ELSE webinar_invitations.status
                    END

                RETURNING *
                `,
                [
                  randomUUID(),
                  row.id,
                  target.id,
                  target.public_id,
                  input.role,
                ],
              )
            ).rows[0];

          created.push(
            invitation,
          );

          await notify(
            target.id,
            row.id,
            'WEBINAR_INVITATION',
          ).catch(
            () => {},
          );
        }

        await pool.query(
          `
          INSERT INTO webinar_audit(
            webinar_id,
            actor_id,
            action,
            details
          )
          VALUES(
            $1,$2,
            'INVITATIONS_SENT',
            $3
          )
          `,
          [
            row.id,
            user.id,
            {
              count:
                created.length,
            },
          ],
        );

        res.json({
          data:
            created,
        });
      },
    ),
  );

  r.get(
    '/api/v2/events/invitations/mine',
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
                SELECT
                  i.*,
                  w.title,
                  w.starts_at,
                  w.ends_at,
                  w.language,
                  w.presenter_code,
                  w.status AS event_status

                FROM webinar_invitations i

                JOIN webinars w
                  ON w.id=i.webinar_id

                WHERE i.invitee_id=$1

                ORDER BY
                  w.starts_at DESC
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

  r.post(
    '/api/v2/events/invitations/:id/respond',
    endpoint(
      async (
        req,
        res,
      ) => {
        const user =
            await principal(
              req,
            ),

          id =
            uuid.parse(
              req.params.id,
            ),

          input =
            z
              .object({
                accepted:
                  z.boolean(),
              })
              .strict()
              .parse(
                req.body,
              );

        const invitation =
          (
            await pool.query(
              `
              UPDATE webinar_invitations
              SET
                status=$3,
                responded_at=now()
              WHERE id=$1
                AND invitee_id=$2
                AND status IN(
                  'INVITED',
                  'DECLINED'
                )
              RETURNING *
              `,
              [
                id,
                user.id,
                input.accepted
                  ? 'ACCEPTED'
                  : 'DECLINED',
              ],
            )
          ).rows[0];

        if (
          !invitation
        )
          throw new ServiceError(
            409,
            'INVALID_INVITATION',
          );

        if (
          !input.accepted
        ) {
          res.json({
            data:
              invitation,
          });

          return;
        }

        const row =
          await load(
            pool,
            invitation.webinar_id,
          );

        const reg =
          await register(
            pool,
            row,
            user,
            invitation.role,
          );

        await pool.query(
          `
          UPDATE webinar_invitations
          SET status=$2
          WHERE id=$1
          `,
          [
            invitation.id,
            reg.status ===
              'REGISTERED'
              ? 'REGISTERED'
              : 'ACCEPTED',
          ],
        );

        res.json({
          data: {
            invitation_id:
              invitation.id,

            registration:
              reg,
          },
        });
      },
    ),
  );

  /*
   * Registration.
   */
  r.post(
    '/api/v2/events/:id/register',
    endpoint(
      async (
        req,
        res,
      ) => {
        const user =
            await principal(
              req,
            ),

          row =
            await load(
              pool,
              uuid.parse(
                req.params.id,
              ),
            );

        const result =
          await register(
            pool,
            row,
            user,
          );

        res.status(
          201,
        ).json({
          data:
            result,
        });
      },
    ),
  );

  r.get(
    '/api/v2/events/mine',
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
                SELECT DISTINCT
                  w.*,
                  r.role,
                  r.status AS registration_status,
                  r.raised_hand,
                  r.microphone_allowed,
                  r.camera_allowed

                FROM webinars w

                LEFT JOIN webinar_registrations r
                  ON r.webinar_id=w.id
                 AND r.account_id=$1

                WHERE w.presenter_id=$1
                   OR w.sponsor_id=$1
                   OR r.account_id=$1

                ORDER BY w.starts_at DESC

                LIMIT 200
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

  /*
   * Payment service hooks prepared for Work23.3 payment UI.
   */
  r.get(
    '/internal/events/payment-quote/:id',
    endpoint(
      async (
        req,
        res,
      ) => {
        const user =
            await principal(
              req,
            ),

          id =
            uuid.parse(
              req.params.id,
            ),

          reg =
            (
              await pool.query(
                `
                SELECT
                  r.*,
                  w.presenter_id,
                  w.price_minor,
                  w.currency,
                  w.status AS event_status,
                  w.ends_at

                FROM webinar_registrations r

                JOIN webinars w
                  ON w.id=r.webinar_id

                WHERE r.id=$1
                `,
                [
                  id,
                ],
              )
            ).rows[0];

        if (
          !reg ||
          reg.account_id !==
            user.id ||
          reg.status !==
            'PENDING_PAYMENT' ||
          !reg.hold_expires_at ||
          Date.parse(
            reg.hold_expires_at,
          ) <=
            Date.now() ||
          ![
            'PUBLISHED',
            'LIVE',
          ].includes(
            reg.event_status,
          )
        )
          throw new ServiceError(
            409,
            'EVENT_REGISTRATION_UNAVAILABLE',
          );

        res.json({
          data: {
            id:
              reg.id,

            account_id:
              reg.account_id,

            expert_id:
              reg.presenter_id,

            amount:
              String(
                reg.price_minor,
              ),

            currency:
              reg.currency,

            status:
              reg.status,

            expires_at:
              reg.hold_expires_at,

            kind:
              'EVENT',

            specialty_id:
              null,

            country:
              '',

            end_at:
              reg.ends_at,
          },
        });
      },
    ),
  );

  r.post(
    '/internal/events/payment-confirm',
    endpoint(
      async (
        req,
        res,
      ) => {
        const input =
          z
            .object({
              registration_id:
                uuid,

              payment_id:
                uuid,

              account_id:
                uuid,

              amount:
                z
                  .string()
                  .regex(
                    /^[1-9][0-9]{0,15}$/,
                  ),

              currency,
            })
            .strict()
            .parse(
              req.body,
            );

        const result =
          await transaction(
            pool,
            async (
              db,
            ) => {
              const reg =
                (
                  await db.query(
                    `
                    SELECT
                      r.*,
                      w.price_minor,
                      w.currency,
                      w.status AS event_status

                    FROM webinar_registrations r

                    JOIN webinars w
                      ON w.id=r.webinar_id

                    WHERE r.id=$1
                    FOR UPDATE OF r
                    `,
                    [
                      input.registration_id,
                    ],
                  )
                ).rows[0];

              if (
                !reg ||
                reg.account_id !==
                  input.account_id ||
                String(
                  reg.price_minor,
                ) !==
                  input.amount ||
                reg.currency !==
                  input.currency
              )
                throw new ServiceError(
                  409,
                  'EVENT_PAYMENT_MISMATCH',
                );

              if (
                reg.status ===
                'REGISTERED' &&
                reg.payment_id ===
                  input.payment_id
              )
                return reg;

              if (
                reg.status !==
                  'PENDING_PAYMENT' ||
                !reg.hold_expires_at ||
                Date.parse(
                  reg.hold_expires_at,
                ) <=
                  Date.now()
              )
                throw new ServiceError(
                  409,
                  'EVENT_HOLD_EXPIRED',
                );

              return (
                await db.query(
                  `
                  UPDATE webinar_registrations
                  SET
                    status='REGISTERED',
                    payment_id=$2,
                    hold_expires_at=NULL,
                    updated_at=now()
                  WHERE id=$1
                  RETURNING *
                  `,
                  [
                    reg.id,
                    input.payment_id,
                  ],
                )
              ).rows[0];
            },
          );

        const row =
          await load(
            pool,
            result.webinar_id,
          );

        await ensureChat(
          row,
          result.account_id,
          result.role,
        );

        res.json({
          data: {
            status:
              result.status,
          },
        });
      },
    ),
  );

  /*
   * Presenter control / live Webinar.
   */
  r.get(
    '/api/v2/events/:id/participants',
    endpoint(
      async (
        req,
        res,
      ) => {
        const row =
            await load(
              pool,
              uuid.parse(
                req.params.id,
              ),
            );

        await presenter(
          req,
          row,
        );

        res.json({
          data:
            (
              await pool.query(
                `
                SELECT
                  account_code,
                  role,
                  status,
                  media_identity,
                  microphone_allowed,
                  camera_allowed,
                  raised_hand,
                  joined_at,
                  created_at

                FROM webinar_registrations

                WHERE webinar_id=$1
                  AND status='REGISTERED'

                ORDER BY
                  raised_hand DESC,
                  role,
                  created_at
                `,
                [
                  row.id,
                ],
              )
            ).rows,
        });
      },
    ),
  );

  r.post(
    '/api/v2/events/:id/raise-hand',
    endpoint(
      async (
        req,
        res,
      ) => {
        const user =
            await principal(
              req,
            ),

          row =
            await load(
              pool,
              uuid.parse(
                req.params.id,
              ),
            ),

          input =
            z
              .object({
                raised:
                  z.boolean(),
              })
              .strict()
              .parse(
                req.body,
              );

        if (
          !row.raise_hand_enabled
        )
          throw new ServiceError(
            409,
            'RAISE_HAND_DISABLED',
          );

        const result =
          await pool.query(
            `
            UPDATE webinar_registrations
            SET
              raised_hand=$3,
              updated_at=now()
            WHERE webinar_id=$1
              AND account_id=$2
              AND status='REGISTERED'
              AND role IN(
                'ATTENDEE',
                'SPONSOR',
                'MODERATOR'
              )
            RETURNING id
            `,
            [
              row.id,
              user.id,
              input.raised,
            ],
          );

        if (
          !result.rowCount
        )
          throw new ServiceError(
            403,
            'NOT_REGISTERED',
          );

        res.json({
          data: {
            raised:
              input.raised,
          },
        });
      },
    ),
  );

  r.post(
    '/api/v2/events/:id/grant',
    endpoint(
      async (
        req,
        res,
      ) => {
        const row =
            await load(
              pool,
              uuid.parse(
                req.params.id,
              ),
            ),

          user =
            await presenter(
              req,
              row,
            ),

          input =
            z
              .object({
                account:
                  code,

                microphone:
                  z.boolean(),

                camera:
                  z.boolean(),

                role:
                  z
                    .enum([
                      'ATTENDEE',
                      'MODERATOR',
                      'SPONSOR',
                    ])
                    .optional(),
              })
              .strict()
              .parse(
                req.body,
              );

        const target =
          (
            await pool.query(
              `
              UPDATE webinar_registrations
              SET
                microphone_allowed=$3,
                camera_allowed=$4,
                role=COALESCE($5,role),
                raised_hand=false,
                updated_at=now()

              WHERE webinar_id=$1
                AND account_code=$2
                AND status='REGISTERED'
                AND role<>'PRESENTER'

              RETURNING *
              `,
              [
                row.id,
                input.account,
                input.microphone,
                input.camera,
                input.role ??
                  null,
              ],
            )
          ).rows[0] as
            | Registration
            | undefined;

        if (
          !target
        )
          throw new ServiceError(
            404,
            'PARTICIPANT_NOT_FOUND',
          );

        if (
          row.status ===
          'LIVE'
        )
          await internalCall(
            'media-service',
            '/internal/webinars/permissions',
            '',
            {
              event_id:
                row.id,

              identity:
                target.media_identity,

              microphone:
                target.microphone_allowed,

              camera:
                target.camera_allowed,

              screen:
                false,
            },
          ).catch(
            (
              error,
            ) => {
              if (
                error instanceof
                  ServiceError &&
                error.code ===
                  'PARTICIPANT_NOT_CONNECTED'
              )
                return;

              throw error;
            },
          );

        await pool.query(
          `
          INSERT INTO webinar_audit(
            webinar_id,
            actor_id,
            action,
            details
          )
          VALUES(
            $1,$2,
            'MEDIA_PERMISSION_CHANGED',
            $3
          )
          `,
          [
            row.id,
            user.id,
            {
              account:
                input.account,

              microphone:
                input.microphone,

              camera:
                input.camera,
            },
          ],
        );

        res.json({
          data:
            target,
        });
      },
    ),
  );

  r.post(
    '/api/v2/events/:id/start',
    endpoint(
      async (
        req,
        res,
      ) => {
        const row =
            await load(
              pool,
              uuid.parse(
                req.params.id,
              ),
            ),

          user =
            await presenter(
              req,
              row,
            );

        if (
          ![
            'PUBLISHED',
            'LIVE',
          ].includes(
            row.status,
          )
        )
          throw new ServiceError(
            409,
            'EVENT_NOT_PUBLISHED',
          );

        if (
          Date.now() <
          Date.parse(
            row.starts_at,
          ) -
            30 *
              60 *
              1000
        )
          throw new ServiceError(
            409,
            'EVENT_TOO_EARLY',
          );

        await internalCall(
          'media-service',
          '/internal/webinars/open',
          '',
          {
            event_id:
              row.id,

            capacity:
              row.capacity,
          },
        );

        await pool.query(
          `
          UPDATE webinars
          SET
            status='LIVE',
            updated_at=now()
          WHERE id=$1
          `,
          [
            row.id,
          ],
        );

        await pool.query(
          `
          INSERT INTO webinar_audit(
            webinar_id,
            actor_id,
            action
          )
          VALUES(
            $1,$2,'STARTED'
          )
          `,
          [
            row.id,
            user.id,
          ],
        );

        res.json({
          data: {
            status:
              'LIVE',
          },
        });
      },
    ),
  );

  r.post(
    '/api/v2/events/:id/end',
    endpoint(
      async (
        req,
        res,
      ) => {
        const row =
            await load(
              pool,
              uuid.parse(
                req.params.id,
              ),
            ),

          user =
            await presenter(
              req,
              row,
            );

        if (
          row.status !==
          'LIVE'
        )
          throw new ServiceError(
            409,
            'EVENT_NOT_LIVE',
          );

        await internalCall(
          'media-service',
          '/internal/webinars/end',
          '',
          {
            event_id:
              row.id,
          },
        );

        await pool.query(
          `
          UPDATE webinars
          SET
            status='COMPLETED',
            updated_at=now()
          WHERE id=$1
          `,
          [
            row.id,
          ],
        );

        await pool.query(
          `
          INSERT INTO webinar_audit(
            webinar_id,
            actor_id,
            action
          )
          VALUES(
            $1,$2,'COMPLETED'
          )
          `,
          [
            row.id,
            user.id,
          ],
        );

        res.json({
          data: {
            status:
              'COMPLETED',
          },
        });
      },
    ),
  );

  r.post(
    '/api/v2/events/:id/join',
    endpoint(
      async (
        req,
        res,
      ) => {
        const user =
            await principal(
              req,
            ),

          row =
            await load(
              pool,
              uuid.parse(
                req.params.id,
              ),
            ),

          reg =
            await registration(
              pool,
              row.id,
              user.id,
            );

        if (
          !reg ||
          reg.status !==
            'REGISTERED'
        )
          throw new ServiceError(
            403,
            'NOT_REGISTERED',
          );

        const now =
          Date.now();

        if (
          now <
            Date.parse(
              row.starts_at,
            ) -
              30 *
                60 *
                1000 ||
          now >
            Date.parse(
              row.ends_at,
            ) +
              60 *
                60 *
                1000
        )
          throw new ServiceError(
            409,
            'EVENT_JOIN_WINDOW',
          );

        if (
          row.status !==
            'LIVE'
        )
          throw new ServiceError(
            409,
            'PRESENTER_HAS_NOT_STARTED',
          );

        const chat =
          await ensureChat(
            row,
            user.id,
            reg.role,
          );

        const presenterRole =
          reg.role ===
          'PRESENTER';

        const token =
          await internalCall(
            'media-service',
            '/internal/webinars/token',
            '',
            {
              event_id:
                row.id,

              identity:
                reg.media_identity,

              role:
                reg.role,

              microphone:
                presenterRole ||
                reg.microphone_allowed,

              camera:
                presenterRole ||
                reg.camera_allowed,

              screen:
                presenterRole,
            },
          );

        await pool.query(
          `
          UPDATE webinar_registrations
          SET
            joined_at=COALESCE(
              joined_at,
              now()
            ),
            updated_at=now()
          WHERE id=$1
          `,
          [
            reg.id,
          ],
        );

        await pool.query(
          `
          UPDATE webinar_invitations
          SET status='JOINED'
          WHERE webinar_id=$1
            AND invitee_id=$2
          `,
          [
            row.id,
            user.id,
          ],
        );

        res.json({
          data: {
            event: {
              id:
                row.id,

              title:
                row.title,

              starts_at:
                row.starts_at,

              ends_at:
                row.ends_at,

              presenter_code:
                row.presenter_code,

              chat_enabled:
                row.chat_enabled,

              qna_enabled:
                row.qna_enabled,

              raise_hand_enabled:
                row.raise_hand_enabled,
            },

            role:
              reg.role,

            chat_conversation_id:
              chat?.id ??
              null,

            media:
              token,
          },
        });
      },
    ),
  );

  /*
   * Messaging service authorization.
   */
  r.post(
    '/internal/events/:id/chat-authorize',
    endpoint(
      async (
        req,
        res,
      ) => {
        const id =
            uuid.parse(
              req.params.id,
            ),

          input =
            z
              .object({
                account_id:
                  uuid,
              })
              .strict()
              .parse(
                req.body,
              ),

          row =
            await load(
              pool,
              id,
            );

        if (
          !row.chat_enabled ||
          [
            'CANCELLED',
          ].includes(
            row.status,
          )
        )
          throw new ServiceError(
            403,
            'CHAT_NOT_ALLOWED',
          );

        const reg =
          await registration(
            pool,
            id,
            input.account_id,
          );

        if (
          !reg ||
          reg.status !==
            'REGISTERED'
        )
          throw new ServiceError(
            403,
            'NOT_REGISTERED',
          );

        res.json({
          data: {
            ok:
              true,

            role:
              reg.role,
          },
        });
      },
    ),
  );

  return r;
}

export function eventWorker(
  pool: Pool,
) {
  let busy =
    false;

  const tick =
    async () => {
      if (
        busy
      )
        return;

      busy =
        true;

      try {
        /*
         * Release unpaid capacity holds.
         */
        await pool.query(
          `
          UPDATE webinar_registrations
          SET
            status='CANCELLED',
            updated_at=now()
          WHERE status='PENDING_PAYMENT'
            AND hold_expires_at<=now()
          `,
        );

        /*
         * Reminders at 24h / 1h / 10m.
         */
        for (
          const minutes
          of [
            1440,
            60,
            10,
          ]
        ) {
          const registrations =
            (
              await pool.query(
                `
                SELECT
                  w.id AS webinar_id,
                  r.account_id

                FROM webinars w

                JOIN webinar_registrations r
                  ON r.webinar_id=w.id

                WHERE w.status='PUBLISHED'
                  AND r.status='REGISTERED'
                  AND w.starts_at>now()
                  AND w.starts_at<=
                    now() +
                    (
                      $1::int *
                      interval '1 minute'
                    )

                  AND NOT EXISTS(
                    SELECT 1
                    FROM webinar_reminders d
                    WHERE d.webinar_id=w.id
                      AND d.account_id=r.account_id
                      AND d.minutes=$1::int
                  )

                LIMIT 200
                `,
                [
                  minutes,
                ],
              )
            ).rows;

          for (
            const item
            of registrations
          ) {
            try {
              await notify(
                item.account_id,
                item.webinar_id,
                `WEBINAR_REMINDER_${minutes}`,
              );

              await pool.query(
                `
                INSERT INTO webinar_reminders(
                  webinar_id,
                  account_id,
                  minutes
                )
                VALUES(
                  $1,$2,$3
                )
                ON CONFLICT DO NOTHING
                `,
                [
                  item.webinar_id,
                  item.account_id,
                  minutes,
                ],
              );
            } catch {
              /*
               * Leave missing reminder row so the next tick
               * retries delivery.
               */
            }
          }
        }
      } finally {
        busy =
          false;
      }
    };

  const timer =
    setInterval(
      () => {
        void tick().catch(
          () => {
            /*
             * A reminder/cleanup failure must not terminate
             * event-service. The next worker cycle retries.
             */
          },
        );
      },
      60000,
    );

  timer.unref();

  void tick().catch(
    () => {
      /*
       * Startup cleanup/reminders are best-effort.
       * Health and API serving must not crash because a
       * background reminder cycle failed.
       */
    },
  );

  return timer;
}
