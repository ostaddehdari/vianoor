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
  transaction,
} from '@vianoor/service-runtime';

type RedisLike = {
  get(
    key: string,
  ):
    Promise<
      string | null
    >;

  set(
    key: string,
    value: string,
    options?:
      Record<
        string,
        unknown
      >,
  ):
    Promise<unknown>;

  del(
    key: string,
  ):
    Promise<unknown>;
};

type ExpertSetting = {
  expert_id: string;
  expert_code: string;
  enabled: boolean;
  timezone: string;
  weekly_windows: {
    day: number;
    start: string;
    end: string;
  }[];
  languages: string[];
  topics: string[];
  modes: string[];
  price_minor: string;
  currency: string;
  offer_seconds: number;
  session_minutes: number;
  busy_request_id: string | null;
  last_offer_at: string | null;
  revision: number;
  updated_at: string;
};

type InstantRequest = {
  id: string;
  client_id: string;
  client_code: string;
  topic_id: string | null;
  language: string;
  mode: string;
  notes: string;
  status: string;
  expert_id: string | null;
  expert_code: string | null;
  offer_id: string | null;
  price_minor: string;
  currency: string;
  session_minutes: number;
  payment_id: string | null;
  payment_expires_at: string | null;
  request_key: string;
  request_data: Record<string, unknown>;
  created_at: string;
  matched_at: string | null;
  ready_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  updated_at: string;
};

const uuid =
  z.string().uuid();

const code =
  z
    .string()
    .regex(
      /^[A-Za-z0-9]{13}$/,
    );

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

const hhmm =
  z
    .string()
    .regex(
      /^(?:[01]\d|2[0-3]):[0-5]\d$/,
    );

const windowSchema =
  z
    .object({
      day:
        z
          .number()
          .int()
          .min(0)
          .max(6),

      start:
        hhmm,

      end:
        hhmm,
    })
    .strict()
    .refine(
      value =>
        value.start !==
        value.end,
      {
        message:
          'ZERO_LENGTH_WINDOW',
      },
    );

const expertSettingsSchema =
  z
    .object({
      enabled:
        z.boolean(),

      timezone:
        z
          .string()
          .trim()
          .min(1)
          .max(100),

      weekly_windows:
        z
          .array(
            windowSchema,
          )
          .max(28),

      languages:
        z
          .array(
            language,
          )
          .min(1)
          .max(30),

      topics:
        z
          .array(
            uuid,
          )
          .max(100)
          .default([]),

      modes:
        z
          .array(
            z.enum([
              'AUDIO',
              'VIDEO',
            ]),
          )
          .min(1)
          .max(2),

      price_minor:
        z
          .string()
          .regex(
            /^[0-9]{1,16}$/,
          ),

      currency,

      offer_seconds:
        z
          .number()
          .int()
          .min(15)
          .max(120)
          .default(45),

      session_minutes:
        z
          .number()
          .int()
          .min(5)
          .max(180)
          .default(30),
    })
    .strict()
    .superRefine(
      (
        value,
        context,
      ) => {
        try {
          new Intl.DateTimeFormat(
            'en-US',
            {
              timeZone:
                value.timezone,
            },
          ).format();
        } catch {
          context.addIssue({
            code:
              'custom',

            path: [
              'timezone',
            ],

            message:
              'INVALID_TIMEZONE',
          });
        }
      },
    );

const requestSchema =
  z
    .object({
      request_key:
        uuid,

      topic_id:
        uuid
          .nullable()
          .default(null),

      language,

      mode:
        z.enum([
          'AUDIO',
          'VIDEO',
        ]),

      notes:
        z
          .string()
          .trim()
          .max(2000)
          .default(''),
    })
    .strict();

function minutes(
  value: string,
) {
  const [
    hour,
    minute,
  ] =
    value
      .split(':')
      .map(
        Number,
      );

  return (
    hour! *
      60 +
    minute!
  );
}

const weekdays: Record<
  string,
  number
> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function clock(
  timezone: string,
) {
  const parts =
    new Intl.DateTimeFormat(
      'en-US',
      {
        timeZone:
          timezone,

        weekday:
          'short',

        hour:
          '2-digit',

        minute:
          '2-digit',

        hourCycle:
          'h23',
      },
    ).formatToParts(
      new Date(),
    );

  const get =
    (
      type: string,
    ) =>
      parts.find(
        part =>
          part.type ===
          type,
      )?.value ??
      '';

  return {
    day:
      weekdays[
        get(
          'weekday',
        )
      ] ??
      -1,

    minute:
      Number(
        get(
          'hour',
        ),
      ) *
        60 +
      Number(
        get(
          'minute',
        ),
      ),
  };
}

function scheduledNow(
  setting: ExpertSetting,
) {
  const now =
    clock(
      setting.timezone,
    );

  if (
    now.day <
    0
  )
    return false;

  return setting.weekly_windows.some(
    window => {
      const start =
          minutes(
            window.start,
          ),

        end =
          minutes(
            window.end,
          );

      if (
        start <
        end
      )
        return (
          window.day ===
            now.day &&
          now.minute >=
            start &&
          now.minute <
            end
        );

      return (
        (
          window.day ===
            now.day &&
          now.minute >=
            start
        ) ||
        (
          (
            window.day +
            1
          ) %
            7 ===
            now.day &&
          now.minute <
            end
        )
      );
    },
  );
}

async function verifiedExpert(
  publicId: string,
) {
  const value =
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
    !value.verified
  )
    throw new ServiceError(
      403,
      'VERIFIED_EXPERT_REQUIRED',
    );
}

async function notify(
  accountId: string,
  contextId: string,
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
        contextId,

      category:
        'MESSAGES',

      event,
    },
  );
}

async function audit(
  db:
    | Pool
    | PoolClient,
  requestId:
    | string
    | null,
  actorId:
    | string
    | null,
  action: string,
  details:
    Record<
      string,
      unknown
    > =
      {},
) {
  await db.query(
    `
    INSERT INTO instant_audit(
      request_id,
      actor_id,
      action,
      details
    )
    VALUES(
      $1,$2,$3,$4
    )
    `,
    [
      requestId,
      actorId,
      action,
      details,
    ],
  );
}

async function loadRequest(
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
        FROM instant_requests
        WHERE id=$1
        ${lock ? 'FOR UPDATE' : ''}
        `,
        [
          id,
        ],
      )
    ).rows[0] as
      | InstantRequest
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

async function queuePosition(
  pool: Pool,
  row: InstantRequest,
) {
  if (
    ![
      'QUEUED',
      'OFFERING',
    ].includes(
      row.status,
    )
  )
    return null;

  return Number(
    (
      await pool.query(
        `
        SELECT count(*)::int AS count
        FROM instant_requests
        WHERE status IN(
          'QUEUED',
          'OFFERING'
        )
          AND (
            created_at<$1
            OR (
              created_at=$1
              AND id<=$2
            )
          )
        `,
        [
          row.created_at,
          row.id,
        ],
      )
    ).rows[0]
      .count,
  );
}

async function presentRequest(
  pool: Pool,
  row: InstantRequest,
) {
  const offer =
    row.offer_id
      ? (
          await pool.query(
            `
            SELECT
              id,
              status,
              expires_at
            FROM instant_offers
            WHERE id=$1
            `,
            [
              row.offer_id,
            ],
          )
        ).rows[0] ??
        null
      : null;

  return {
    ...row,

    queue_position:
      await queuePosition(
        pool,
        row,
      ),

    offer:
      offer,
  };
}

async function findCandidates(
  pool: Pool,
  redis: RedisLike,
  row: InstantRequest,
) {
  const candidates =
    (
      await pool.query(
        `
        SELECT *
        FROM instant_experts e

        WHERE e.enabled
          AND e.busy_request_id IS NULL
          AND $2=ANY(e.languages)
          AND $3=ANY(e.modes)

          AND (
            cardinality(e.topics)=0
            OR $4::uuid IS NULL
            OR $4=ANY(e.topics)
          )

          AND NOT EXISTS(
            SELECT 1
            FROM instant_offers o
            WHERE o.request_id=$1
              AND o.expert_id=e.expert_id
          )

        ORDER BY
          e.last_offer_at
            NULLS FIRST,
          e.updated_at,
          e.expert_id

        LIMIT 100
        `,
        [
          row.id,
          row.language,
          row.mode,
          row.topic_id,
        ],
      )
    ).rows as
      ExpertSetting[];

  const eligible:
    ExpertSetting[] =
      [];

  for (
    const candidate
    of candidates
  ) {
    if (
      !scheduledNow(
        candidate,
      )
    )
      continue;

    if (
      await redis.get(
        'presence:' +
          candidate.expert_id,
      ) !==
      'ONLINE'
    )
      continue;

    eligible.push(
      candidate,
    );
  }

  return eligible;
}

async function dispatchOne(
  pool: Pool,
  redis: RedisLike,
) {
  const row =
    (
      await pool.query(
        `
        SELECT *
        FROM instant_requests
        WHERE status='QUEUED'
        ORDER BY created_at,id
        LIMIT 1
        `,
      )
    ).rows[0] as
      | InstantRequest
      | undefined;

  if (
    !row
  )
    return false;

  const candidates =
    await findCandidates(
      pool,
      redis,
      row,
    );

  for (
    const candidate
    of candidates
  ) {
    const result =
      await transaction(
        pool,
        async (
          db,
        ) => {
          const current =
              await loadRequest(
                db,
                row.id,
                true,
              ),

            expert =
              (
                await db.query(
                  `
                  SELECT *
                  FROM instant_experts
                  WHERE expert_id=$1
                  FOR UPDATE
                  `,
                  [
                    candidate.expert_id,
                  ],
                )
              ).rows[0] as
                | ExpertSetting
                | undefined;

          if (
            current.status !==
              'QUEUED' ||
            !expert ||
            !expert.enabled ||
            expert.busy_request_id
          )
            return null;

          if (
            !scheduledNow(
              expert,
            )
          )
            return null;

          if (
            await redis.get(
              'presence:' +
                expert.expert_id,
            ) !==
            'ONLINE'
          )
            return null;

          const id =
              randomUUID(),

            sequence =
              Number(
                (
                  await db.query(
                    `
                    SELECT
                      COALESCE(
                        max(sequence),
                        0
                      )::int + 1
                        AS sequence
                    FROM instant_offers
                    WHERE request_id=$1
                    `,
                    [
                      current.id,
                    ],
                  )
                ).rows[0]
                  .sequence,
              );

          const offer =
            (
              await db.query(
                `
                INSERT INTO instant_offers(
                  id,
                  request_id,
                  expert_id,
                  expert_code,
                  sequence,
                  status,
                  expires_at
                )
                VALUES(
                  $1,$2,$3,$4,$5,
                  'OFFERED',
                  now() +
                    ($6::int *
                     interval '1 second')
                )
                RETURNING *
                `,
                [
                  id,
                  current.id,
                  expert.expert_id,
                  expert.expert_code,
                  sequence,
                  expert.offer_seconds,
                ],
              )
            ).rows[0];

          await db.query(
            `
            UPDATE instant_experts
            SET
              busy_request_id=$2,
              last_offer_at=now(),
              updated_at=now()
            WHERE expert_id=$1
            `,
            [
              expert.expert_id,
              current.id,
            ],
          );

          await db.query(
            `
            UPDATE instant_requests
            SET
              status='OFFERING',
              expert_id=$2,
              expert_code=$3,
              offer_id=$4,
              updated_at=now()
            WHERE id=$1
            `,
            [
              current.id,
              expert.expert_id,
              expert.expert_code,
              offer.id,
            ],
          );

          await audit(
            db,
            current.id,
            expert.expert_id,
            'OFFER_CREATED',
            {
              offer_id:
                offer.id,

              sequence:
                offer.sequence,

              expires_at:
                offer.expires_at,
            },
          );

          return {
            offer,
            expert,
          };
        },
      );

    if (
      result
    ) {
      await notify(
        result.expert.expert_id,
        row.id,
        'INSTANT_OFFER',
      ).catch(
        () => {},
      );

      return true;
    }
  }

  return false;
}

async function expireOffers(
  pool: Pool,
) {
  const offers =
    (
      await pool.query(
        `
        SELECT
          id,
          request_id,
          expert_id
        FROM instant_offers
        WHERE status='OFFERED'
          AND expires_at<=now()
        ORDER BY expires_at
        LIMIT 100
        `,
      )
    ).rows;

  for (
    const offer
    of offers
  )
    await transaction(
      pool,
      async (
        db,
      ) => {
        const locked =
          (
            await db.query(
              `
              SELECT *
              FROM instant_offers
              WHERE id=$1
              FOR UPDATE
              `,
              [
                offer.id,
              ],
            )
          ).rows[0];

        if (
          !locked ||
          locked.status !==
            'OFFERED' ||
          Date.parse(
            locked.expires_at,
          ) >
            Date.now()
        )
          return;

        await db.query(
          `
          UPDATE instant_offers
          SET
            status='EXPIRED',
            responded_at=now()
          WHERE id=$1
          `,
          [
            locked.id,
          ],
        );

        await db.query(
          `
          UPDATE instant_experts
          SET
            busy_request_id=NULL,
            updated_at=now()
          WHERE expert_id=$1
            AND busy_request_id=$2
          `,
          [
            locked.expert_id,
            locked.request_id,
          ],
        );

        await db.query(
          `
          UPDATE instant_requests
          SET
            status='QUEUED',
            expert_id=NULL,
            expert_code=NULL,
            offer_id=NULL,
            updated_at=now()
          WHERE id=$1
            AND status='OFFERING'
            AND offer_id=$2
          `,
          [
            locked.request_id,
            locked.id,
          ],
        );

        await audit(
          db,
          locked.request_id,
          locked.expert_id,
          'OFFER_EXPIRED',
        );
      },
    );
}

async function expirePayments(
  pool: Pool,
) {
  const rows =
    (
      await pool.query(
        `
        SELECT
          id,
          expert_id
        FROM instant_requests
        WHERE status='AWAITING_PAYMENT'
          AND payment_expires_at<=now()
        LIMIT 100
        `,
      )
    ).rows;

  for (
    const row
    of rows
  )
    await transaction(
      pool,
      async (
        db,
      ) => {
        const current =
          await loadRequest(
            db,
            row.id,
            true,
          );

        if (
          current.status !==
          'AWAITING_PAYMENT' ||
          !current.payment_expires_at ||
          Date.parse(
            current.payment_expires_at,
          ) >
            Date.now()
        )
          return;

        await db.query(
          `
          UPDATE instant_requests
          SET
            status='CANCELLED',
            updated_at=now()
          WHERE id=$1
          `,
          [
            current.id,
          ],
        );

        if (
          current.expert_id
        )
          await db.query(
            `
            UPDATE instant_experts
            SET
              busy_request_id=NULL,
              updated_at=now()
            WHERE expert_id=$1
              AND busy_request_id=$2
            `,
            [
              current.expert_id,
              current.id,
            ],
          );

        await audit(
          db,
          current.id,
          null,
          'PAYMENT_TIMEOUT',
        );
      },
    );
}

async function initialize(
  pool: Pool,
) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS instant_experts(
      expert_id uuid PRIMARY KEY,
      expert_code varchar(13) NOT NULL UNIQUE,

      enabled boolean NOT NULL DEFAULT false,

      timezone text NOT NULL DEFAULT 'UTC',

      weekly_windows jsonb NOT NULL DEFAULT '[]',

      languages text[] NOT NULL DEFAULT '{}',

      topics uuid[] NOT NULL DEFAULT '{}',

      modes text[] NOT NULL DEFAULT '{}',

      price_minor numeric(30,0) NOT NULL
        DEFAULT 0
        CHECK(price_minor>=0),

      currency text NOT NULL DEFAULT 'USD',

      offer_seconds int NOT NULL DEFAULT 45
        CHECK(offer_seconds BETWEEN 15 AND 120),

      session_minutes int NOT NULL DEFAULT 30
        CHECK(session_minutes BETWEEN 5 AND 180),

      busy_request_id uuid,

      last_offer_at timestamptz,

      revision int NOT NULL DEFAULT 1,

      created_at timestamptz NOT NULL DEFAULT now(),

      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS instant_requests(
      id uuid PRIMARY KEY,

      client_id uuid NOT NULL,

      client_code varchar(13) NOT NULL,

      topic_id uuid,

      language text NOT NULL,

      mode text NOT NULL
        CHECK(mode IN(
          'AUDIO',
          'VIDEO'
        )),

      notes text NOT NULL DEFAULT '',

      status text NOT NULL
        CHECK(status IN(
          'QUEUED',
          'OFFERING',
          'AWAITING_PAYMENT',
          'READY',
          'LIVE',
          'COMPLETED',
          'CANCELLED'
        )),

      expert_id uuid,

      expert_code varchar(13),

      offer_id uuid,

      price_minor numeric(30,0) NOT NULL DEFAULT 0,

      currency text NOT NULL DEFAULT 'USD',

      session_minutes int NOT NULL DEFAULT 30,

      payment_id uuid,

      payment_expires_at timestamptz,

      request_key uuid NOT NULL,

      request_data jsonb NOT NULL DEFAULT '{}',

      created_at timestamptz NOT NULL DEFAULT now(),

      matched_at timestamptz,

      ready_at timestamptz,

      started_at timestamptz,

      ended_at timestamptz,

      updated_at timestamptz NOT NULL DEFAULT now(),

      UNIQUE(
        client_id,
        request_key
      )
    );

    CREATE INDEX IF NOT EXISTS instant_queue
      ON instant_requests(
        status,
        created_at
      );

    CREATE INDEX IF NOT EXISTS instant_client
      ON instant_requests(
        client_id,
        created_at DESC
      );

    CREATE INDEX IF NOT EXISTS instant_expert_requests
      ON instant_requests(
        expert_id,
        created_at DESC
      );

    CREATE TABLE IF NOT EXISTS instant_offers(
      id uuid PRIMARY KEY,

      request_id uuid NOT NULL
        REFERENCES instant_requests(id)
        ON DELETE CASCADE,

      expert_id uuid NOT NULL,

      expert_code varchar(13) NOT NULL,

      sequence int NOT NULL,

      status text NOT NULL
        CHECK(status IN(
          'OFFERED',
          'ACCEPTED',
          'REJECTED',
          'EXPIRED',
          'CANCELLED'
        )),

      offered_at timestamptz NOT NULL DEFAULT now(),

      expires_at timestamptz NOT NULL,

      responded_at timestamptz,

      UNIQUE(
        request_id,
        expert_id
      ),

      UNIQUE(
        request_id,
        sequence
      )
    );

    CREATE INDEX IF NOT EXISTS instant_offer_expert
      ON instant_offers(
        expert_id,
        status,
        expires_at
      );

    CREATE TABLE IF NOT EXISTS instant_audit(
      id bigserial PRIMARY KEY,

      request_id uuid,

      actor_id uuid,

      action text NOT NULL,

      details jsonb NOT NULL DEFAULT '{}',

      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

function router(
  pool: Pool,
  redis: RedisLike,
) {
  const r =
    internalRouter(
      '256kb',
    );

  /*
   * Public availability summary.
   * No Expert identity is exposed here.
   */
  r.get(
    '/api/v2/instant/public/status',
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

              mode:
                z
                  .enum([
                    'AUDIO',
                    'VIDEO',
                  ])
                  .optional(),
            })
            .strict()
            .parse(
              req.query,
            );

        const rows =
          (
            await pool.query(
              `
              SELECT *
              FROM instant_experts
              WHERE enabled
                AND (
                  $1::text IS NULL
                  OR $1=ANY(languages)
                )
                AND (
                  $2::text IS NULL
                  OR $2=ANY(modes)
                )
              LIMIT 500
              `,
              [
                query.language ??
                  null,
                query.mode ??
                  null,
              ],
            )
          ).rows as
            ExpertSetting[];

        let available =
          0;

        for (
          const setting
          of rows
        ) {
          if (
            !scheduledNow(
              setting,
            )
          )
            continue;

          if (
            await redis.get(
              'presence:' +
                setting.expert_id,
            ) !==
            'ONLINE'
          )
            continue;

          if (
            setting.busy_request_id
          )
            continue;

          available++;
        }

        res.json({
          data: {
            available_experts:
              available,

            queue_open:
              available >
              0,
          },
        });
      },
    ),
  );

  /*
   * Expert settings.
   */
  r.get(
    '/api/v2/instant/expert/settings',
    endpoint(
      async (
        req,
        res,
      ) => {
        const user =
          await principal(
            req,
          );

        await verifiedExpert(
          user.public_id,
        );

        res.json({
          data:
            (
              await pool.query(
                `
                SELECT *
                FROM instant_experts
                WHERE expert_id=$1
                `,
                [
                  user.id,
                ],
              )
            ).rows[0] ??
            null,
        });
      },
    ),
  );

  r.put(
    '/api/v2/instant/expert/settings',
    endpoint(
      async (
        req,
        res,
      ) => {
        const user =
            await principal(
              req,
            );

        await verifiedExpert(
          user.public_id,
        );

        const input =
          expertSettingsSchema.parse(
            req.body,
          );

        const row =
          (
            await pool.query(
              `
              INSERT INTO instant_experts(
                expert_id,
                expert_code,
                enabled,
                timezone,
                weekly_windows,
                languages,
                topics,
                modes,
                price_minor,
                currency,
                offer_seconds,
                session_minutes
              )
              VALUES(
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
              )

              ON CONFLICT(expert_id)
              DO UPDATE SET
                expert_code=$2,
                enabled=$3,
                timezone=$4,
                weekly_windows=$5,
                languages=$6,
                topics=$7,
                modes=$8,
                price_minor=$9,
                currency=$10,
                offer_seconds=$11,
                session_minutes=$12,
                revision=
                  instant_experts.revision +
                  1,
                updated_at=now()

              RETURNING *
              `,
              [
                user.id,
                user.public_id,
                input.enabled,
                input.timezone,
                JSON.stringify(
                  input.weekly_windows,
                ),
                input.languages,
                input.topics,
                input.modes,
                input.price_minor,
                input.currency,
                input.offer_seconds,
                input.session_minutes,
              ],
            )
          ).rows[0];

        await audit(
          pool,
          null,
          user.id,
          'EXPERT_SETTINGS_UPDATED',
          {
            enabled:
              input.enabled,

            languages:
              input.languages,

            modes:
              input.modes,
          },
        );

        res.json({
          data:
            row,
        });
      },
    ),
  );

  /*
   * This uses the same Redis key as presence-service.
   * It lets an Expert explicitly enter/leave Talk Now mode
   * while preserving one source of truth for online state.
   */
  r.post(
    '/api/v2/instant/expert/presence',
    endpoint(
      async (
        req,
        res,
      ) => {
        const user =
            await principal(
              req,
            );

        await verifiedExpert(
          user.public_id,
        );

        const input =
          z
            .object({
              state:
                z.enum([
                  'ONLINE',
                  'AWAY',
                  'OFFLINE',
                ]),
            })
            .strict()
            .parse(
              req.body,
            );

        if (
          input.state ===
          'OFFLINE'
        )
          await redis.del(
            'presence:' +
              user.id,
          );
        else
          await redis.set(
            'presence:' +
              user.id,
            input.state,
            {
              EX:
                75,
            },
          );

        res.json({
          data: {
            state:
              input.state,
          },
        });
      },
    ),
  );

  /*
   * Client creates a Talk Now request.
   * There is no Booking and no calendar reservation.
   */
  r.post(
    '/api/v2/instant/requests',
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
            requestSchema.parse(
              req.body,
            );

        const old =
          (
            await pool.query(
              `
              SELECT *
              FROM instant_requests
              WHERE client_id=$1
                AND request_key=$2
              `,
              [
                user.id,
                input.request_key,
              ],
            )
          ).rows[0] as
            | InstantRequest
            | undefined;

        if (
          old
        ) {
          if (
            JSON.stringify(
              old.request_data,
            ) !==
            JSON.stringify(
              input,
            )
          )
            throw new ServiceError(
              409,
              'IDEMPOTENCY_CONFLICT',
            );

          res.json({
            data:
              await presentRequest(
                pool,
                old,
              ),
          });

          return;
        }

        if (
          (
            await pool.query(
              `
              SELECT 1
              FROM instant_requests
              WHERE client_id=$1
                AND status IN(
                  'QUEUED',
                  'OFFERING',
                  'AWAITING_PAYMENT',
                  'READY',
                  'LIVE'
                )
              LIMIT 1
              `,
              [
                user.id,
              ],
            )
          ).rowCount
        )
          throw new ServiceError(
            409,
            'ACTIVE_REQUEST_EXISTS',
          );

        const id =
          randomUUID();

        const row =
          (
            await pool.query(
              `
              INSERT INTO instant_requests(
                id,
                client_id,
                client_code,
                topic_id,
                language,
                mode,
                notes,
                status,
                request_key,
                request_data
              )
              VALUES(
                $1,$2,$3,$4,$5,$6,$7,
                'QUEUED',
                $8,$9
              )
              RETURNING *
              `,
              [
                id,
                user.id,
                user.public_id,
                input.topic_id,
                input.language,
                input.mode,
                input.notes,
                input.request_key,
                input,
              ],
            )
          ).rows[0] as
            InstantRequest;

        await audit(
          pool,
          row.id,
          user.id,
          'QUEUED',
          {
            language:
              row.language,

            mode:
              row.mode,

            topic_id:
              row.topic_id,
          },
        );

        /*
         * Worker normally dispatches within one second.
         * Also attempt synchronously for lowest latency.
         */
        await dispatchOne(
          pool,
          redis,
        ).catch(
          () => {},
        );

        res.status(
          201,
        ).json({
          data:
            await presentRequest(
              pool,
              await loadRequest(
                pool,
                row.id,
              ),
            ),
        });
      },
    ),
  );

  r.get(
    '/api/v2/instant/requests/mine',
    endpoint(
      async (
        req,
        res,
      ) => {
        const user =
          await principal(
            req,
          );

        const rows =
          (
            await pool.query(
              `
              SELECT *
              FROM instant_requests
              WHERE client_id=$1
              ORDER BY created_at DESC
              LIMIT 100
              `,
              [
                user.id,
              ],
            )
          ).rows as
            InstantRequest[];

        res.json({
          data:
            await Promise.all(
              rows.map(
                row =>
                  presentRequest(
                    pool,
                    row,
                  ),
              ),
            ),
        });
      },
    ),
  );

  r.get(
    '/api/v2/instant/requests/:id',
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
            await loadRequest(
              pool,
              uuid.parse(
                req.params.id,
              ),
            );

        if (
          row.client_id !==
            user.id &&
          row.expert_id !==
            user.id
        )
          throw new ServiceError(
            403,
            'FORBIDDEN',
          );

        res.json({
          data:
            await presentRequest(
              pool,
              row,
            ),
        });
      },
    ),
  );

  r.post(
    '/api/v2/instant/requests/:id/cancel',
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
            );

        const row =
          await transaction(
            pool,
            async (
              db,
            ) => {
              const current =
                await loadRequest(
                  db,
                  id,
                  true,
                );

              if (
                current.client_id !==
                user.id
              )
                throw new ServiceError(
                  403,
                  'FORBIDDEN',
                );

              if (
                [
                  'LIVE',
                  'COMPLETED',
                  'CANCELLED',
                ].includes(
                  current.status,
                )
              )
                throw new ServiceError(
                  409,
                  'INVALID_TRANSITION',
                );

              if (
                current.offer_id
              )
                await db.query(
                  `
                  UPDATE instant_offers
                  SET
                    status=
                      CASE
                        WHEN status='OFFERED'
                        THEN 'CANCELLED'
                        ELSE status
                      END,
                    responded_at=
                      CASE
                        WHEN status='OFFERED'
                        THEN now()
                        ELSE responded_at
                      END
                  WHERE id=$1
                  `,
                  [
                    current.offer_id,
                  ],
                );

              if (
                current.expert_id
              )
                await db.query(
                  `
                  UPDATE instant_experts
                  SET
                    busy_request_id=NULL,
                    updated_at=now()
                  WHERE expert_id=$1
                    AND busy_request_id=$2
                  `,
                  [
                    current.expert_id,
                    current.id,
                  ],
                );

              const result =
                (
                  await db.query(
                    `
                    UPDATE instant_requests
                    SET
                      status='CANCELLED',
                      updated_at=now()
                    WHERE id=$1
                    RETURNING *
                    `,
                    [
                      current.id,
                    ],
                  )
                ).rows[0] as
                  InstantRequest;

              await audit(
                db,
                result.id,
                user.id,
                'CANCELLED',
              );

              return result;
            },
          );

        res.json({
          data:
            await presentRequest(
              pool,
              row,
            ),
        });
      },
    ),
  );

  /*
   * Expert's active timed offer.
   */
  r.get(
    '/api/v2/instant/offers/current',
    endpoint(
      async (
        req,
        res,
      ) => {
        const user =
          await principal(
            req,
          );

        await verifiedExpert(
          user.public_id,
        );

        res.json({
          data:
            (
              await pool.query(
                `
                SELECT
                  o.id,
                  o.request_id,
                  o.sequence,
                  o.status,
                  o.offered_at,
                  o.expires_at,

                  r.client_code,
                  r.topic_id,
                  r.language,
                  r.mode,
                  r.notes,
                  r.created_at

                FROM instant_offers o

                JOIN instant_requests r
                  ON r.id=o.request_id

                WHERE o.expert_id=$1
                  AND o.status='OFFERED'
                  AND o.expires_at>now()
                  AND r.status='OFFERING'

                ORDER BY o.offered_at

                LIMIT 1
                `,
                [
                  user.id,
                ],
              )
            ).rows[0] ??
            null,
        });
      },
    ),
  );

  r.post(
    '/api/v2/instant/offers/:id/respond',
    endpoint(
      async (
        req,
        res,
      ) => {
        const user =
            await principal(
              req,
            );

        await verifiedExpert(
          user.public_id,
        );

        const id =
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

        const result =
          await transaction(
            pool,
            async (
              db,
            ) => {
              const offer =
                  (
                    await db.query(
                      `
                      SELECT *
                      FROM instant_offers
                      WHERE id=$1
                        AND expert_id=$2
                      FOR UPDATE
                      `,
                      [
                        id,
                        user.id,
                      ],
                    )
                  ).rows[0],

                setting =
                  (
                    await db.query(
                      `
                      SELECT *
                      FROM instant_experts
                      WHERE expert_id=$1
                      FOR UPDATE
                      `,
                      [
                        user.id,
                      ],
                    )
                  ).rows[0] as
                    | ExpertSetting
                    | undefined;

              if (
                !offer ||
                !setting
              )
                throw new ServiceError(
                  404,
                  'OFFER_NOT_FOUND',
                );

              const request =
                await loadRequest(
                  db,
                  offer.request_id,
                  true,
                );

              if (
                offer.status !==
                  'OFFERED' ||
                request.status !==
                  'OFFERING' ||
                request.offer_id !==
                  offer.id
              )
                throw new ServiceError(
                  409,
                  'OFFER_NOT_ACTIVE',
                );

              if (
                Date.parse(
                  offer.expires_at,
                ) <=
                Date.now()
              ) {
                await db.query(
                  `
                  UPDATE instant_offers
                  SET
                    status='EXPIRED',
                    responded_at=now()
                  WHERE id=$1
                  `,
                  [
                    offer.id,
                  ],
                );

                await db.query(
                  `
                  UPDATE instant_experts
                  SET
                    busy_request_id=NULL,
                    updated_at=now()
                  WHERE expert_id=$1
                    AND busy_request_id=$2
                  `,
                  [
                    user.id,
                    request.id,
                  ],
                );

                await db.query(
                  `
                  UPDATE instant_requests
                  SET
                    status='QUEUED',
                    expert_id=NULL,
                    expert_code=NULL,
                    offer_id=NULL,
                    updated_at=now()
                  WHERE id=$1
                  `,
                  [
                    request.id,
                  ],
                );

                return {
                  state:
                    'EXPIRED',

                  request_id:
                    request.id,
                };
              }

              if (
                !input.accepted
              ) {
                await db.query(
                  `
                  UPDATE instant_offers
                  SET
                    status='REJECTED',
                    responded_at=now()
                  WHERE id=$1
                  `,
                  [
                    offer.id,
                  ],
                );

                await db.query(
                  `
                  UPDATE instant_experts
                  SET
                    busy_request_id=NULL,
                    updated_at=now()
                  WHERE expert_id=$1
                    AND busy_request_id=$2
                  `,
                  [
                    user.id,
                    request.id,
                  ],
                );

                await db.query(
                  `
                  UPDATE instant_requests
                  SET
                    status='QUEUED',
                    expert_id=NULL,
                    expert_code=NULL,
                    offer_id=NULL,
                    updated_at=now()
                  WHERE id=$1
                  `,
                  [
                    request.id,
                  ],
                );

                await audit(
                  db,
                  request.id,
                  user.id,
                  'OFFER_REJECTED',
                  {
                    offer_id:
                      offer.id,
                  },
                );

                return {
                  state:
                    'REJECTED',

                  request_id:
                    request.id,
                };
              }

              const paid =
                  BigInt(
                    setting.price_minor,
                  ) >
                  0n,

                status =
                  paid
                    ? 'AWAITING_PAYMENT'
                    : 'READY';

              await db.query(
                `
                UPDATE instant_offers
                SET
                  status='ACCEPTED',
                  responded_at=now()
                WHERE id=$1
                `,
                [
                  offer.id,
                ],
              );

              const accepted =
                (
                  await db.query(
                    `
                    UPDATE instant_requests
                    SET
                      status=$2,
                      expert_id=$3,
                      expert_code=$4,
                      price_minor=$5,
                      currency=$6,
                      session_minutes=$7,
                      matched_at=now(),
                      ready_at=
                        CASE
                          WHEN $2='READY'
                          THEN now()
                          ELSE NULL
                        END,
                      payment_expires_at=
                        CASE
                          WHEN $2='AWAITING_PAYMENT'
                          THEN now() +
                            interval '10 minutes'
                          ELSE NULL
                        END,
                      updated_at=now()
                    WHERE id=$1
                    RETURNING *
                    `,
                    [
                      request.id,
                      status,
                      setting.expert_id,
                      setting.expert_code,
                      setting.price_minor,
                      setting.currency,
                      setting.session_minutes,
                    ],
                  )
                ).rows[0] as
                  InstantRequest;

              await audit(
                db,
                accepted.id,
                user.id,
                'OFFER_ACCEPTED',
                {
                  offer_id:
                    offer.id,

                  status,
                },
              );

              return {
                state:
                  'ACCEPTED',

                request:
                  accepted,
              };
            },
          );

        if (
          result.state ===
          'EXPIRED'
        )
          throw new ServiceError(
            409,
            'OFFER_EXPIRED',
          );

        if (
          result.state ===
          'ACCEPTED' &&
          'request' in
            result
        )
          await notify(
            result.request
              .client_id,
            result.request.id,
            'INSTANT_ACCEPTED',
          ).catch(
            () => {},
          );

        res.json({
          data:
            result,
        });
      },
    ),
  );

  /*
   * Payment contract.
   * Payment-service wiring is added in Work23.4 checkpoint 2.
   */
  r.get(
    '/internal/instant/payment-quote/:id',
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
            await loadRequest(
              pool,
              uuid.parse(
                req.params.id,
              ),
            );

        if (
          row.client_id !==
            user.id ||
          row.status !==
            'AWAITING_PAYMENT' ||
          !row.payment_expires_at ||
          Date.parse(
            row.payment_expires_at,
          ) <=
            Date.now()
        )
          throw new ServiceError(
            409,
            'INSTANT_PAYMENT_UNAVAILABLE',
          );

        res.json({
          data: {
            id:
              row.id,

            account_id:
              row.client_id,

            expert_id:
              row.expert_id,

            amount:
              String(
                row.price_minor,
              ),

            currency:
              row.currency,

            status:
              row.status,

            expires_at:
              row.payment_expires_at,

            kind:
              'INSTANT',

            specialty_id:
              null,

            country:
              '',

            end_at:
              new Date(
                Date.now() +
                  row.session_minutes *
                    60000,
              ).toISOString(),
          },
        });
      },
    ),
  );

  r.post(
    '/internal/instant/payment-confirm',
    endpoint(
      async (
        req,
        res,
      ) => {
        const input =
          z
            .object({
              request_id:
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

        const row =
          await transaction(
            pool,
            async (
              db,
            ) => {
              const current =
                await loadRequest(
                  db,
                  input.request_id,
                  true,
                );

              if (
                current.client_id !==
                  input.account_id ||
                String(
                  current.price_minor,
                ) !==
                  input.amount ||
                current.currency !==
                  input.currency
              )
                throw new ServiceError(
                  409,
                  'INSTANT_PAYMENT_MISMATCH',
                );

              if (
                current.status ===
                  'READY' &&
                current.payment_id ===
                  input.payment_id
              )
                return current;

              if (
                current.status !==
                  'AWAITING_PAYMENT' ||
                !current.payment_expires_at ||
                Date.parse(
                  current.payment_expires_at,
                ) <=
                  Date.now()
              )
                throw new ServiceError(
                  409,
                  'INSTANT_PAYMENT_EXPIRED',
                );

              const result =
                (
                  await db.query(
                    `
                    UPDATE instant_requests
                    SET
                      status='READY',
                      payment_id=$2,
                      payment_expires_at=NULL,
                      ready_at=now(),
                      updated_at=now()
                    WHERE id=$1
                    RETURNING *
                    `,
                    [
                      current.id,
                      input.payment_id,
                    ],
                  )
                ).rows[0] as
                  InstantRequest;

              await audit(
                db,
                result.id,
                null,
                'PAYMENT_CONFIRMED',
                {
                  payment_id:
                    input.payment_id,
                },
              );

              return result;
            },
          );

        res.json({
          data: {
            status:
              row.status,
          },
        });
      },
    ),
  );

  /*
   * Media/messaging integration contract for checkpoint 2.
   */
  r.get(
    '/internal/instant/session-context/:id',
    endpoint(
      async (
        req,
        res,
      ) => {
        const row =
          await loadRequest(
            pool,
            uuid.parse(
              req.params.id,
            ),
          );

        if (
          ![
            'READY',
            'LIVE',
            'COMPLETED',
          ].includes(
            row.status,
          ) ||
          !row.expert_id
        )
          throw new ServiceError(
            409,
            'INSTANT_SESSION_UNAVAILABLE',
          );

        res.json({
          data: {
            id:
              row.id,

            client_id:
              row.client_id,

            client_code:
              row.client_code,

            expert_id:
              row.expert_id,

            expert_code:
              row.expert_code,

            status:
              row.status,

            mode:
              row.mode,

            language:
              row.language,

            session_minutes:
              row.session_minutes,

            started_at:
              row.started_at,

            ended_at:
              row.ended_at,
          },
        });
      },
    ),
  );

  r.post(
    '/internal/instant/session-start',
    endpoint(
      async (
        req,
        res,
      ) => {
        const input =
          z
            .object({
              request_id:
                uuid,
            })
            .strict()
            .parse(
              req.body,
            );

        const result =
          (
            await pool.query(
              `
              UPDATE instant_requests
              SET
                status='LIVE',
                started_at=
                  COALESCE(
                    started_at,
                    now()
                  ),
                updated_at=now()
              WHERE id=$1
                AND status='READY'
              RETURNING *
              `,
              [
                input.request_id,
              ],
            )
          ).rows[0] as
            | InstantRequest
            | undefined;

        if (
          !result
        )
          throw new ServiceError(
            409,
            'INSTANT_NOT_READY',
          );

        await audit(
          pool,
          result.id,
          null,
          'SESSION_STARTED',
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

  r.post(
    '/internal/instant/session-end',
    endpoint(
      async (
        req,
        res,
      ) => {
        const input =
          z
            .object({
              request_id:
                uuid,
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
              const current =
                await loadRequest(
                  db,
                  input.request_id,
                  true,
                );

              if (
                current.status !==
                'LIVE'
              )
                throw new ServiceError(
                  409,
                  'INSTANT_NOT_LIVE',
                );

              const ended =
                (
                  await db.query(
                    `
                    UPDATE instant_requests
                    SET
                      status='COMPLETED',
                      ended_at=now(),
                      updated_at=now()
                    WHERE id=$1
                    RETURNING *
                    `,
                    [
                      current.id,
                    ],
                  )
                ).rows[0] as
                  InstantRequest;

              if (
                current.expert_id
              )
                await db.query(
                  `
                  UPDATE instant_experts
                  SET
                    busy_request_id=NULL,
                    updated_at=now()
                  WHERE expert_id=$1
                    AND busy_request_id=$2
                  `,
                  [
                    current.expert_id,
                    current.id,
                  ],
                );

              await audit(
                db,
                ended.id,
                null,
                'SESSION_COMPLETED',
              );

              return ended;
            },
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

  r.post(
    '/internal/instant/:id/chat-authorize',
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
            await loadRequest(
              pool,
              id,
            );

        if (
          ![
            'READY',
            'LIVE',
            'COMPLETED',
          ].includes(
            row.status,
          ) ||
          ![
            row.client_id,
            row.expert_id,
          ].includes(
            input.account_id,
          )
        )
          throw new ServiceError(
            403,
            'INSTANT_CHAT_NOT_ALLOWED',
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
   * Join a matched instant consultation.
   *
   * Media and Messaging are created lazily only when a
   * READY/LIVE consultation is actually entered.
   */
  r.post(
    '/api/v2/instant/requests/:id/join',
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
            await loadRequest(
              pool,
              uuid.parse(
                req.params.id,
              ),
            );

        if (
          !row.expert_id ||
          ![
            row.client_id,
            row.expert_id,
          ].includes(
            user.id,
          )
        )
          throw new ServiceError(
            403,
            'FORBIDDEN',
          );

        if (
          ![
            'READY',
            'LIVE',
          ].includes(
            row.status,
          )
        )
          throw new ServiceError(
            409,
            'INSTANT_NOT_READY',
          );

        const conversation =
          await internalCall<{
            id: string;
          }>(
            'messaging-service',
            '/internal/communications/instant',
            '',
            {
              request_id:
                row.id,

              client_id:
                row.client_id,

              expert_id:
                row.expert_id,
            },
          );

        await internalCall(
          'media-service',
          '/internal/instant/open',
          '',
          {
            request_id:
              row.id,
          },
        );

        const media =
          await internalCall(
            'media-service',
            '/internal/instant/token',
            '',
            {
              request_id:
                row.id,

              identity:
                user.id,
            },
          );

        res.json({
          data: {
            request:
              await presentRequest(
                pool,
                await loadRequest(
                  pool,
                  row.id,
                ),
              ),

            conversation_id:
              conversation.id,

            media,
          },
        });
      },
    ),
  );

  /*
   * Payment-service refund hook.
   *
   * A consultation already LIVE/COMPLETED cannot be
   * silently cancelled through the ordinary refund path.
   */
  r.post(
    '/internal/instant/financial-cancel',
    endpoint(
      async (
        req,
        res,
      ) => {
        const input =
          z
            .object({
              request_id:
                uuid,

              payment_id:
                uuid,
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
              const current =
                await loadRequest(
                  db,
                  input.request_id,
                  true,
                );

              if (
                [
                  'LIVE',
                  'COMPLETED',
                ].includes(
                  current.status,
                )
              )
                throw new ServiceError(
                  409,
                  'INSTANT_REFUND_WINDOW_CLOSED',
                );

              if (
                current.payment_id &&
                current.payment_id !==
                  input.payment_id
              )
                throw new ServiceError(
                  409,
                  'INSTANT_PAYMENT_MISMATCH',
                );

              if (
                current.status ===
                  'CANCELLED'
              )
                return current;

              const cancelled =
                (
                  await db.query(
                    `
                    UPDATE instant_requests
                    SET
                      status='CANCELLED',
                      updated_at=now()
                    WHERE id=$1
                    RETURNING *
                    `,
                    [
                      current.id,
                    ],
                  )
                ).rows[0] as
                  InstantRequest;

              if (
                current.expert_id
              )
                await db.query(
                  `
                  UPDATE instant_experts
                  SET
                    busy_request_id=NULL,
                    updated_at=now()
                  WHERE expert_id=$1
                    AND busy_request_id=$2
                  `,
                  [
                    current.expert_id,
                    current.id,
                  ],
                );

              await audit(
                db,
                current.id,
                null,
                'FINANCIAL_CANCELLED',
                {
                  payment_id:
                    input.payment_id,
                },
              );

              return cancelled;
            },
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
   * Call-center operator view.
   *
   * Authorization is owned by organization-service.
   */
  r.get(
    '/api/v2/instant/operator/queue',
    endpoint(
      async (
        req,
        res,
      ) => {
        await internalCall(
          'organization-service',
          '/internal/authorize',
          req.get(
            'authorization',
          ) ??
            '',
          {
            permission:
              'call.answer',

            scope:
              'platform',
          },
        );

        const query =
          z
            .object({
              status:
                z
                  .enum([
                    'QUEUED',
                    'OFFERING',
                    'AWAITING_PAYMENT',
                    'READY',
                    'LIVE',
                    'COMPLETED',
                    'CANCELLED',
                  ])
                  .optional(),
            })
            .strict()
            .parse(
              req.query,
            );

        const rows =
          (
            await pool.query(
              `
              SELECT *
              FROM instant_requests

              WHERE (
                $1::text IS NULL
                OR status=$1
              )

              ORDER BY
                CASE status
                  WHEN 'LIVE'
                  THEN 0
                  WHEN 'READY'
                  THEN 1
                  WHEN 'AWAITING_PAYMENT'
                  THEN 2
                  WHEN 'OFFERING'
                  THEN 3
                  WHEN 'QUEUED'
                  THEN 4
                  ELSE 5
                END,
                created_at

              LIMIT 300
              `,
              [
                query.status ??
                  null,
              ],
            )
          ).rows as
            InstantRequest[];

        res.json({
          data:
            await Promise.all(
              rows.map(
                row =>
                  presentRequest(
                    pool,
                    row,
                  ),
              ),
            ),
        });
      },
    ),
  );

  r.post(
    '/api/v2/instant/operator/requests/:id',
    endpoint(
      async (
        req,
        res,
      ) => {
        const operator =
          await principal(
            req,
          );

        await internalCall(
          'organization-service',
          '/internal/authorize',
          req.get(
            'authorization',
          ) ??
            '',
          {
            permission:
              'call.answer',

            scope:
              'platform',
          },
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
                    'CANCEL',
                    'REQUEUE',
                  ]),
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
              const current =
                await loadRequest(
                  db,
                  id,
                  true,
                );

              if (
                [
                  'LIVE',
                  'COMPLETED',
                ].includes(
                  current.status,
                )
              )
                throw new ServiceError(
                  409,
                  'INVALID_TRANSITION',
                );

              if (
                current.offer_id
              )
                await db.query(
                  `
                  UPDATE instant_offers
                  SET
                    status=
                      CASE
                        WHEN status='OFFERED'
                        THEN 'CANCELLED'
                        ELSE status
                      END,
                    responded_at=
                      CASE
                        WHEN status='OFFERED'
                        THEN now()
                        ELSE responded_at
                      END
                  WHERE id=$1
                  `,
                  [
                    current.offer_id,
                  ],
                );

              if (
                current.expert_id
              )
                await db.query(
                  `
                  UPDATE instant_experts
                  SET
                    busy_request_id=NULL,
                    updated_at=now()
                  WHERE expert_id=$1
                    AND busy_request_id=$2
                  `,
                  [
                    current.expert_id,
                    current.id,
                  ],
                );

              const status =
                input.action ===
                  'REQUEUE'
                  ? 'QUEUED'
                  : 'CANCELLED';

              const row =
                (
                  await db.query(
                    `
                    UPDATE instant_requests
                    SET
                      status=$2,
                      expert_id=
                        CASE
                          WHEN $2='QUEUED'
                          THEN NULL
                          ELSE expert_id
                        END,
                      expert_code=
                        CASE
                          WHEN $2='QUEUED'
                          THEN NULL
                          ELSE expert_code
                        END,
                      offer_id=
                        CASE
                          WHEN $2='QUEUED'
                          THEN NULL
                          ELSE offer_id
                        END,
                      updated_at=now()
                    WHERE id=$1
                    RETURNING *
                    `,
                    [
                      current.id,
                      status,
                    ],
                  )
                ).rows[0] as
                  InstantRequest;

              await audit(
                db,
                row.id,
                operator.id,
                'OPERATOR_' +
                  input.action,
              );

              return row;
            },
          );

        res.json({
          data:
            await presentRequest(
              pool,
              result,
            ),
        });
      },
    ),
  );

  /*
   * Support-service ownership check.
   *
   * Unlike session-context this endpoint works for every
   * Talk Now state, including QUEUED/OFFERING/CANCELLED.
   */
  r.post(
    '/internal/instant/:id/support-authorize',
    endpoint(
      async (
        req,
        res,
      ) => {
        const row =
            await loadRequest(
              pool,
              uuid.parse(
                req.params.id,
              ),
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
              );

        if (
          ![
            row.client_id,
            row.expert_id,
          ].includes(
            input.account_id,
          )
        )
          throw new ServiceError(
            403,
            'FORBIDDEN',
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
   * Matched request currently owned by this Expert.
   */
  r.get(
    '/api/v2/instant/expert/current',
    endpoint(
      async (
        req,
        res,
      ) => {
        const user =
          await principal(
            req,
          );

        await verifiedExpert(
          user.public_id,
        );

        const row =
          (
            await pool.query(
              `
              SELECT *
              FROM instant_requests
              WHERE expert_id=$1
                AND status IN(
                  'AWAITING_PAYMENT',
                  'READY',
                  'LIVE'
                )
              ORDER BY updated_at DESC
              LIMIT 1
              `,
              [
                user.id,
              ],
            )
          ).rows[0] as
            | InstantRequest
            | undefined;

        res.json({
          data:
            row
              ? await presentRequest(
                  pool,
                  row,
                )
              : null,
        });
      },
    ),
  );

  /*
   * The matched Expert explicitly ends the active call.
   * Client disconnect remains reconnectable and does not
   * silently complete the consultation.
   */
  r.post(
    '/api/v2/instant/requests/:id/end',
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
            await loadRequest(
              pool,
              uuid.parse(
                req.params.id,
              ),
            );

        if (
          row.expert_id !==
          user.id
        )
          throw new ServiceError(
            403,
            'FORBIDDEN',
          );

        if (
          row.status !==
          'LIVE'
        )
          throw new ServiceError(
            409,
            'INSTANT_NOT_LIVE',
          );

        const result =
          await internalCall<{
            status: string;
          }>(
            'media-service',
            '/internal/instant/end',
            '',
            {
              request_id:
                row.id,
            },
          );

        res.json({
          data:
            result,
        });
      },
    ),
  );

  return r;
}

function worker(
  pool: Pool,
  redis: RedisLike,
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
        await expireOffers(
          pool,
        );

        await expirePayments(
          pool,
        );

        for (
          let index =
            0;
          index <
            20;
          index++
        ) {
          const dispatched =
            await dispatchOne(
              pool,
              redis,
            );

          if (
            !dispatched
          )
            break;
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
             * Queue housekeeping is retryable.
             * A failed tick must not terminate instant-service.
             */
          },
        );
      },
      1000,
    );

  timer.unref();

  void tick().catch(
    () => {
      /*
       * Initial dispatch is best-effort.
       * The interval retries one second later.
       */
    },
  );

  return timer;
}

if (
  process.env.INSTANT_ENABLED !==
  '1'
) {
  await bootstrap(
    'instant-service',
    4110,
  );
} else {
  const infra =
    await connectInfrastructure(
      'instant-service',
    );

  await initialize(
    infra.pool!,
  );

  const redis =
    infra.redis as unknown as
      RedisLike;

  const timer =
    worker(
      infra.pool!,
      redis,
    );

  const app =
    await createService(
      'instant-service',
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
                redis,
              ),
            );
          },
      },
    );

  const config =
    readRuntimeConfig(
      4110,
    );

  await app.listen(
    config.port,
    config.host,
  );

  process.once(
    'SIGTERM',
    () => {
      clearInterval(
        timer,
      );
    },
  );
}
