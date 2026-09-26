// Run only inside organization-service. The account ID is read from stdin, never logged.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { internalCall, transaction } from '@vianoor/service-runtime';
const publicId = readFileSync(0, 'utf8').trim();
if (process.env.USERS_ENABLED !== '1' || !/^[A-Za-z0-9]{13}$/.test(publicId))
  throw Error('An enabled users installation and a 13-character account ID are required');
const account = await internalCall('identity-service', '/internal/accounts/' + publicId);
if (!account.verified_at || account.disabled_at)
  throw Error('The initial administrator must be an active verified account');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await transaction(pool, async (db) => {
    if ((await db.query('SELECT current_database() AS name')).rows[0].name !== 'organization_db')
      throw Error('Wrong database owner');
    await db.query('SELECT pg_advisory_xact_lock(20260601)');
    if (
      (await db.query("SELECT 1 FROM role_grants WHERE role='admin' AND scope='platform'")).rowCount
    )
      throw Error('An administrator already exists; use authorized user management');
    await db.query(
      "INSERT INTO role_grants(account_id,public_id,role,scope) VALUES($1,$2,'admin','platform')",
      [account.id, publicId],
    );
    await db.query(
      "INSERT INTO organization_audit(actor_id,target_id,action,scope) VALUES($1,$2,'bootstrap_admin','platform')",
      [account.id, publicId],
    );
  });
  console.log('Initial administrator created and audited.');
} finally {
  await pool.end();
}
