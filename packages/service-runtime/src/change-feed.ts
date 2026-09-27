import type { Pool } from 'pg';
// Infrastructure-only invalidation: relation names and operations, never row contents.
export async function installChangeFeed(pool: Pool, producer: string, tables: string[]) {
  if (
    !/^[a-z][a-z0-9-]+$/.test(producer) ||
    tables.some((table) => !/^[a-z][a-z0-9_]+$/.test(table))
  )
    throw Error('Invalid change feed configuration');
  await pool.query(`CREATE OR REPLACE FUNCTION infra_discovery_changed() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE event uuid := gen_random_uuid();
  BEGIN
    INSERT INTO infra_outbox(event_id,envelope) VALUES(event,jsonb_build_object(
      'event_id',event,'event_type','discovery.catalog.changed.v1','event_version',1,
      'occurred_at',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'producer','${producer}','tenant_id',NULL,'actor_id',NULL,'correlation_id',event,'causation_id',NULL,
      'trace_id',replace(event::text,'-',''),'aggregate_id',event,'aggregate_version',1,
      'data_classification','INTERNAL','payload',jsonb_build_object('relation',TG_TABLE_NAME,'operation',TG_OP)));
    RETURN NULL;
  END; $$;`);
  for (const table of tables)
    await pool.query(
      `DROP TRIGGER IF EXISTS infra_discovery_changed ON ${table}; CREATE TRIGGER infra_discovery_changed AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION infra_discovery_changed();`,
    );
}
