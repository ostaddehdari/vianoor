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
  internalRouter,
  requirePermission,
  ServiceError,
  transaction,
} from '@vianoor/service-runtime';

const titleSchema =
  z
    .object({
      fa:
        z
          .string()
          .trim()
          .min(1)
          .max(80),

      en:
        z
          .string()
          .trim()
          .min(1)
          .max(80),
    })
    .strict();

const socialInput =
  z
    .object({
      key:
        z
          .string()
          .regex(
            /^[a-z0-9-]{1,40}$/,
          ),

      title:
        titleSchema,

      url:
        z
          .string()
          .url()
          .max(500)
          .refine(
            (value) => {
              try {
                const url =
                  new URL(
                    value,
                  );

                return [
                  'http:',
                  'https:',
                ].includes(
                  url.protocol,
                );
              } catch {
                return false;
              }
            },
            'Only HTTP(S) links are allowed',
          ),

      icon:
        z.enum([
          'globe',
          'comments',
          'video',
          'mail',
          'link',
          'share',
        ]),

      enabled:
        z.boolean(),

      position:
        z
          .number()
          .int()
          .min(0)
          .max(10000),
    })
    .strict();

async function audit(
  db: PoolClient,
  actor: string,
  target: string,
  action: string,
) {
  await db.query(
    `
    INSERT INTO site_settings_audit(
      actor_id,
      target,
      action
    )
    VALUES($1,$2,$3)
    `,
    [
      actor,
      target,
      action,
    ],
  );
}

export async function initializeSiteSettings(
  pool: Pool,
) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_social_links(
      id uuid PRIMARY KEY,
      key text UNIQUE NOT NULL,
      title jsonb NOT NULL,
      url text NOT NULL,
      icon text NOT NULL,
      enabled boolean NOT NULL DEFAULT true,
      position int NOT NULL DEFAULT 0,
      revision int NOT NULL DEFAULT 1,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS site_settings_audit(
      id bigserial PRIMARY KEY,
      actor_id uuid NOT NULL,
      target text NOT NULL,
      action text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export function siteSettingsRouter(
  pool: Pool,
) {
  const router =
    internalRouter();

  router.get(
    '/api/v2/site-settings/social-links',

    endpoint(
      async (
        req,
        res,
      ) => {
        const admin =
          req.query.admin ===
          '1';

        if (admin)
          await requirePermission(
            req,
            'platform.configure',
          );

        const rows =
          (
            await pool.query(
              `
              SELECT
                id,
                key,
                title,
                url,
                icon,
                enabled,
                position,
                revision
              FROM site_social_links
              WHERE $1 OR enabled
              ORDER BY
                position,
                key
              `,
              [
                admin,
              ],
            )
          ).rows;

        res.json({
          data: rows,
        });
      },
    ),
  );

  router.post(
    '/api/v2/site-settings/social-links',

    endpoint(
      async (
        req,
        res,
      ) => {
        const actor =
          await requirePermission(
            req,
            'platform.configure',
          );

        const input =
          socialInput.parse(
            req.body,
          );

        const id =
          randomUUID();

        await transaction(
          pool,
          async (db) => {
            await db.query(
              'SELECT pg_advisory_xact_lock(20262101)',
            );

            const row =
              await db.query(
                `
                INSERT INTO site_social_links(
                  id,
                  key,
                  title,
                  url,
                  icon,
                  enabled,
                  position
                )
                VALUES(
                  $1,$2,$3,$4,$5,$6,$7
                )
                ON CONFLICT(key)
                DO NOTHING
                RETURNING id
                `,
                [
                  id,
                  input.key,
                  input.title,
                  input.url,
                  input.icon,
                  input.enabled,
                  input.position,
                ],
              );

            if (
              !row.rowCount
            )
              throw new ServiceError(
                409,
                'CONFLICT',
              );

            await audit(
              db,
              actor.id,
              input.key,
              'social.created',
            );
          },
        );

        res
          .status(201)
          .json({
            data: {
              id,
            },
          });
      },
    ),
  );

  router.put(
    '/api/v2/site-settings/social-links/:id',

    endpoint(
      async (
        req,
        res,
      ) => {
        const actor =
          await requirePermission(
            req,
            'platform.configure',
          );

        const id =
          z
            .string()
            .uuid()
            .parse(
              req.params.id,
            );

        const input =
          socialInput
            .extend({
              revision:
                z
                  .number()
                  .int()
                  .positive(),
            })
            .parse(
              req.body,
            );

        await transaction(
          pool,
          async (db) => {
            await db.query(
              'SELECT pg_advisory_xact_lock(20262101)',
            );

            const result =
              await db.query(
                `
                UPDATE site_social_links
                SET
                  key=$2,
                  title=$3,
                  url=$4,
                  icon=$5,
                  enabled=$6,
                  position=$7,
                  revision=revision+1,
                  updated_at=now()
                WHERE id=$1
                  AND revision=$8
                RETURNING id
                `,
                [
                  id,
                  input.key,
                  input.title,
                  input.url,
                  input.icon,
                  input.enabled,
                  input.position,
                  input.revision,
                ],
              );

            if (
              !result.rowCount
            )
              throw new ServiceError(
                409,
                'CONFLICT',
              );

            await audit(
              db,
              actor.id,
              input.key,
              'social.updated',
            );
          },
        );

        res.json({
          data: {
            id,
          },
        });
      },
    ),
  );

  return router;
}
