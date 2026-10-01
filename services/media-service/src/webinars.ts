import {
  randomUUID,
} from 'node:crypto';

import type {
  Pool,
} from 'pg';

import {
  z,
} from 'zod';

import {
  endpoint,
  internalRouter,
  ServiceError,
} from '@vianoor/service-runtime';

import {
  AccessToken,
  TrackSource,
} from 'livekit-server-sdk';

import {
  livekitConfig,
  rooms,
} from './livekit.js';

const uuid =
  z.string().uuid();

type WebinarRoom = {
  event_id: string;
  room_name: string;
  state: string;
  capacity: number;
};

export async function initializeWebinarMedia(
  pool: Pool,
) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS webinar_rooms(
      event_id uuid PRIMARY KEY,
      room_name text NOT NULL UNIQUE,
      state text NOT NULL
        CHECK(state IN(
          'READY',
          'OPEN',
          'ENDED'
        )),
      capacity int NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function load(
  pool: Pool,
  id: string,
) {
  const row =
    (
      await pool.query(
        `
        SELECT *
        FROM webinar_rooms
        WHERE event_id=$1
        `,
        [
          id,
        ],
      )
    ).rows[0] as
      | WebinarRoom
      | undefined;

  if (
    !row
  )
    throw new ServiceError(
      404,
      'WEBINAR_ROOM_NOT_FOUND',
    );

  return row;
}

async function provision(
  pool: Pool,
  id: string,
  capacity: number,
) {
  return (
    await pool.query(
      `
      INSERT INTO webinar_rooms(
        event_id,
        room_name,
        state,
        capacity
      )
      VALUES(
        $1,$2,'READY',$3
      )

      ON CONFLICT(event_id)
      DO UPDATE SET
        capacity=$3

      RETURNING *
      `,
      [
        id,
        'vw_' +
          randomUUID()
            .replaceAll(
              '-',
              '',
            ),
        capacity,
      ],
    )
  ).rows[0] as WebinarRoom;
}

function sources(
  microphone: boolean,
  camera: boolean,
  screen: boolean,
) {
  const value:
    TrackSource[] =
      [];

  if (
    microphone
  )
    value.push(
      TrackSource.MICROPHONE,
    );

  if (
    camera
  )
    value.push(
      TrackSource.CAMERA,
    );

  if (
    screen
  )
    value.push(
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
    );

  return value;
}

async function token(
  row: WebinarRoom,
  identity: string,
  role: string,
  microphone: boolean,
  camera: boolean,
  screen: boolean,
) {
  const config =
      livekitConfig(),

    allowed =
      sources(
        microphone,
        camera,
        screen,
      ),

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
              event_id:
                row.event_id,
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
      allowed.length >
      0,

    canPublishSources:
      allowed,

    /*
     * Webinar text chat is owned by messaging-service.
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
      microphone,
      camera,
      screen,

      subscribe:
        true,

      text_chat:
        false,
    },
  };
}

export function webinarMediaRouter(
  pool: Pool,
) {
  const r =
    internalRouter();

  r.post(
    '/internal/webinars/provision',
    endpoint(
      async (
        req,
        res,
      ) => {
        const input =
          z
            .object({
              event_id:
                uuid,

              capacity:
                z
                  .number()
                  .int()
                  .min(2)
                  .max(1000),
            })
            .strict()
            .parse(
              req.body,
            );

        res.json({
          data:
            await provision(
              pool,
              input.event_id,
              input.capacity,
            ),
        });
      },
    ),
  );

  r.post(
    '/internal/webinars/open',
    endpoint(
      async (
        req,
        res,
      ) => {
        const input =
          z
            .object({
              event_id:
                uuid,

              capacity:
                z
                  .number()
                  .int()
                  .min(2)
                  .max(1000),
            })
            .strict()
            .parse(
              req.body,
            );

        const row =
          await provision(
            pool,
            input.event_id,
            input.capacity,
          );

        if (
          row.state !==
          'OPEN'
        ) {
          try {
            await rooms().createRoom({
              name:
                row.room_name,

              maxParticipants:
                Math.min(
                  1000,
                  row.capacity +
                    10,
                ),

              emptyTimeout:
                300,

              departureTimeout:
                90,
            });
          } catch (
            error
          ) {
            /*
             * LiveKit may already have auto-created the room.
             */
            const existing =
              await rooms().listRooms([
                row.room_name,
              ]);

            if (
              !existing.length
            )
              throw error;
          }

          await pool.query(
            `
            UPDATE webinar_rooms
            SET
              state='OPEN',
              updated_at=now()
            WHERE event_id=$1
            `,
            [
              row.event_id,
            ],
          );
        }

        res.json({
          data: {
            event_id:
              row.event_id,

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
    '/internal/webinars/token',
    endpoint(
      async (
        req,
        res,
      ) => {
        const input =
            z
              .object({
                event_id:
                  uuid,

                identity:
                  uuid,

                role:
                  z.enum([
                    'PRESENTER',
                    'MODERATOR',
                    'SPONSOR',
                    'ATTENDEE',
                  ]),

                microphone:
                  z.boolean(),

                camera:
                  z.boolean(),

                screen:
                  z.boolean(),
              })
              .strict()
              .parse(
                req.body,
              ),

          row =
            await load(
              pool,
              input.event_id,
            );

        if (
          row.state !==
          'OPEN'
        )
          throw new ServiceError(
            409,
            'WEBINAR_NOT_OPEN',
          );

        /*
         * Presenter is always allowed audio/video/screen.
         * Everyone else receives exactly the grant persisted
         * by event-service.
         */
        const presenter =
          input.role ===
          'PRESENTER';

        res.json({
          data:
            await token(
              row,
              input.identity,
              input.role,
              presenter ||
                input.microphone,
              presenter ||
                input.camera,
              presenter ||
                input.screen,
            ),
        });
      },
    ),
  );

  r.post(
    '/internal/webinars/permissions',
    endpoint(
      async (
        req,
        res,
      ) => {
        const input =
            z
              .object({
                event_id:
                  uuid,

                identity:
                  uuid,

                microphone:
                  z.boolean(),

                camera:
                  z.boolean(),

                screen:
                  z.boolean()
                  .default(false),
              })
              .strict()
              .parse(
                req.body,
              ),

          row =
            await load(
              pool,
              input.event_id,
            );

        if (
          row.state !==
          'OPEN'
        )
          throw new ServiceError(
            409,
            'WEBINAR_NOT_OPEN',
          );

        const allowed =
          sources(
            input.microphone,
            input.camera,
            input.screen,
          );

        try {
          await rooms().updateParticipant(
            row.room_name,
            input.identity,
            undefined,
            {
              canSubscribe:
                true,

              canPublish:
                allowed.length >
                0,

              canPublishSources:
                allowed,

              canPublishData:
                false,
            },
          );
        } catch (
          error
        ) {
          try {
            await rooms().getParticipant(
              row.room_name,
              input.identity,
            );
          } catch {
            throw new ServiceError(
              409,
              'PARTICIPANT_NOT_CONNECTED',
            );
          }

          throw error;
        }

        res.json({
          data: {
            ok:
              true,

            microphone:
              input.microphone,

            camera:
              input.camera,
          },
        });
      },
    ),
  );

  r.get(
    '/internal/webinars/:id/participants',
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

        let participants:
          Awaited<
            ReturnType<
              ReturnType<
                typeof rooms
              >['listParticipants']
            >
          > = [];

        try {
          participants =
            await rooms().listParticipants(
              row.room_name,
            );
        } catch {
          participants =
            [];
        }

        res.json({
          data:
            participants.map(
              (
                item,
              ) => ({
                identity:
                  item.identity,

                name:
                  item.name,

                metadata:
                  item.metadata,

                state:
                  item.state,

                joined_at:
                  item.joinedAt,
              }),
            ),
        });
      },
    ),
  );

  r.post(
    '/internal/webinars/remove',
    endpoint(
      async (
        req,
        res,
      ) => {
        const input =
            z
              .object({
                event_id:
                  uuid,

                identity:
                  uuid,
              })
              .strict()
              .parse(
                req.body,
              ),

          row =
            await load(
              pool,
              input.event_id,
            );

        if (
          row.state ===
          'OPEN'
        )
          await rooms()
            .removeParticipant(
              row.room_name,
              input.identity,
            )
            .catch(
              () => {},
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

  r.post(
    '/internal/webinars/end',
    endpoint(
      async (
        req,
        res,
      ) => {
        const input =
            z
              .object({
                event_id:
                  uuid,
              })
              .strict()
              .parse(
                req.body,
              ),

          row =
            await load(
              pool,
              input.event_id,
            );

        if (
          row.state !==
          'ENDED'
        ) {
          await rooms()
            .deleteRoom(
              row.room_name,
            )
            .catch(
              () => {},
            );

          await pool.query(
            `
            UPDATE webinar_rooms
            SET
              state='ENDED',
              updated_at=now()
            WHERE event_id=$1
            `,
            [
              row.event_id,
            ],
          );
        }

        res.json({
          data: {
            ok:
              true,
          },
        });
      },
    ),
  );

  return r;
}
