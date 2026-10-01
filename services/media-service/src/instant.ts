import {
  AccessToken,
  TrackSource,
} from 'livekit-server-sdk';

import type {
  Pool,
} from 'pg';

import {
  z,
} from 'zod';

import {
  endpoint,
  internalCall,
  internalRouter,
  ServiceError,
} from '@vianoor/service-runtime';

import {
  livekitConfig,
  rooms,
} from './livekit.js';

const uuid =
  z.string().uuid();

type Context = {
  id: string;
  client_id: string;
  client_code: string;
  expert_id: string;
  expert_code: string;
  status: string;
  mode: 'AUDIO' | 'VIDEO';
  language: string;
  session_minutes: number;
  started_at: string | null;
  ended_at: string | null;
};

type RoomRow = {
  request_id: string;
  room_name: string;
  mode: 'AUDIO' | 'VIDEO';
  state: string;
  created_at: string;
  updated_at: string;
};

async function context(
  requestId: string,
) {
  return internalCall<Context>(
    'instant-service',
    '/internal/instant/session-context/' +
      requestId,
  );
}

async function load(
  pool: Pool,
  requestId: string,
) {
  const row =
    (
      await pool.query(
        `
        SELECT *
        FROM instant_rooms
        WHERE request_id=$1
        `,
        [
          requestId,
        ],
      )
    ).rows[0] as
      | RoomRow
      | undefined;

  if (!row)
    throw new ServiceError(
      404,
      'INSTANT_ROOM_NOT_FOUND',
    );

  return row;
}

async function provision(
  pool: Pool,
  requestId: string,
  mode: 'AUDIO' | 'VIDEO',
) {
  const roomName =
    'instant-' +
    requestId;

  return (
    await pool.query(
      `
      INSERT INTO instant_rooms(
        request_id,
        room_name,
        mode
      )
      VALUES(
        $1,$2,$3
      )

      ON CONFLICT(request_id)
      DO UPDATE SET
        mode=EXCLUDED.mode,
        updated_at=now()

      RETURNING *
      `,
      [
        requestId,
        roomName,
        mode,
      ],
    )
  ).rows[0] as
    RoomRow;
}

async function token(
  row: RoomRow,
  ctx: Context,
  identity: string,
) {
  const role =
      identity ===
      ctx.expert_id
        ? 'EXPERT'
        : 'CLIENT',

    camera =
      ctx.mode ===
      'VIDEO',

    sources:
      TrackSource[] = [
        TrackSource.MICROPHONE,
        TrackSource.SCREEN_SHARE,
        TrackSource.SCREEN_SHARE_AUDIO,
      ];

  if (camera)
    sources.push(
      TrackSource.CAMERA,
    );

  const config =
      livekitConfig(),

    access =
      new AccessToken(
        config.key,
        config.secret,
        {
          identity,

          ttl:
            90,

          name:
            role,

          metadata:
            JSON.stringify({
              role,
              instant_request_id:
                row.request_id,
            }),
        },
      );

  access.addGrant({
    room:
      row.room_name,

    roomJoin:
      true,

    canSubscribe:
      true,

    canPublish:
      true,

    canPublishSources:
      sources,

    /*
     * Durable text chat belongs to messaging-service.
     */
    canPublishData:
      false,

    canUpdateOwnMetadata:
      false,

    hidden:
      false,
  });

  return {
    token:
      await access.toJwt(),

    url:
      config.publicUrl,

    expires_in:
      90,

    identity,

    role,

    capabilities: {
      microphone:
        true,

      camera,

      screen:
        true,

      subscribe:
        true,

      text_chat:
        false,
    },
  };
}

export async function initializeInstantMedia(
  pool: Pool,
) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS instant_rooms(
      request_id uuid PRIMARY KEY,

      room_name text NOT NULL UNIQUE,

      mode text NOT NULL
        CHECK(mode IN(
          'AUDIO',
          'VIDEO'
        )),

      state text NOT NULL
        DEFAULT 'PROVISIONED'
        CHECK(state IN(
          'PROVISIONED',
          'OPEN',
          'ENDED'
        )),

      created_at timestamptz NOT NULL
        DEFAULT now(),

      updated_at timestamptz NOT NULL
        DEFAULT now()
    );
  `);
}

export function instantMediaRouter(
  pool: Pool,
) {
  const r =
    internalRouter();

  r.post(
    '/internal/instant/open',
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
              ),

          ctx =
            await context(
              input.request_id,
            ),

          row =
            await provision(
              pool,
              ctx.id,
              ctx.mode,
            );

        if (
          ![
            'READY',
            'LIVE',
          ].includes(
            ctx.status,
          )
        )
          throw new ServiceError(
            409,
            'INSTANT_NOT_READY',
          );

        if (
          row.state !==
          'OPEN'
        ) {
          try {
            await rooms()
              .createRoom({
                name:
                  row.room_name,

                maxParticipants:
                  2,

                emptyTimeout:
                  180,

                departureTimeout:
                  60,
              });
          } catch (
            error
          ) {
            const existing =
              await rooms()
                .listRooms([
                  row.room_name,
                ]);

            if (
              !existing.length
            )
              throw error;
          }

          await pool.query(
            `
            UPDATE instant_rooms
            SET
              state='OPEN',
              updated_at=now()
            WHERE request_id=$1
            `,
            [
              row.request_id,
            ],
          );
        }

        if (
          ctx.status ===
          'READY'
        )
          await internalCall(
            'instant-service',
            '/internal/instant/session-start',
            '',
            {
              request_id:
                ctx.id,
            },
          );

        res.json({
          data: {
            request_id:
              row.request_id,

            room_name:
              row.room_name,

            state:
              'OPEN',
          },
        });
      },
    ),
  );

  r.post(
    '/internal/instant/token',
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

                identity:
                  uuid,
              })
              .strict()
              .parse(
                req.body,
              ),

          ctx =
            await context(
              input.request_id,
            ),

          row =
            await load(
              pool,
              input.request_id,
            );

        if (
          row.state !==
            'OPEN' ||
          ctx.status !==
            'LIVE'
        )
          throw new ServiceError(
            409,
            'INSTANT_ROOM_NOT_OPEN',
          );

        if (
          ![
            ctx.client_id,
            ctx.expert_id,
          ].includes(
            input.identity,
          )
        )
          throw new ServiceError(
            403,
            'FORBIDDEN',
          );

        res.json({
          data:
            await token(
              row,
              ctx,
              input.identity,
            ),
        });
      },
    ),
  );

  r.get(
    '/internal/instant/:id/participants',
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

        if (
          row.state !==
          'OPEN'
        ) {
          res.json({
            data:
              [],
          });

          return;
        }

        const participants =
          await rooms()
            .listParticipants(
              row.room_name,
            )
            .catch(
              () => [],
            );

        res.json({
          data:
            participants.map(
              item => ({
                identity:
                  item.identity,

                name:
                  item.name,

                metadata:
                  item.metadata,

                state:
                  item.state,
              }),
            ),
        });
      },
    ),
  );

  r.post(
    '/internal/instant/end',
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
              ),

          row =
            await load(
              pool,
              input.request_id,
            ),

          ctx =
            await context(
              input.request_id,
            );

        if (
          row.state !==
          'ENDED'
        ) {
          if (
            row.state ===
            'OPEN'
          )
            await rooms()
              .deleteRoom(
                row.room_name,
              )
              .catch(
                () => {},
              );

          await pool.query(
            `
            UPDATE instant_rooms
            SET
              state='ENDED',
              updated_at=now()
            WHERE request_id=$1
            `,
            [
              row.request_id,
            ],
          );
        }

        if (
          ctx.status ===
          'LIVE'
        )
          await internalCall(
            'instant-service',
            '/internal/instant/session-end',
            '',
            {
              request_id:
                ctx.id,
            },
          );

        res.json({
          data: {
            status:
              'ENDED',
          },
        });
      },
    ),
  );

  return r;
}
