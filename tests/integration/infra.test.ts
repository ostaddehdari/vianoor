import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { connect, AckPolicy, StorageType } from 'nats';
import { createClient } from 'redis';
import {
  infrastructureMigration,
  transaction,
  enqueue,
  relayOnce,
  consumeOnce,
  processMessage,
} from '../../packages/service-runtime/dist/index.js';

// Only runs inside the isolated Compose test container. No skip can silently pass this gate.
if (process.env.INFRA_TEST !== '1')
  throw new Error('Run npm run infra:test in a dedicated Compose project');
const env = parseEnv(readFileSync('/run/vianoor/profile-service.env', 'utf8'));
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 2000 });
const event = () => ({
  event_id: randomUUID(),
  event_type: 'profile.probe.created.v1',
  event_version: 1,
  occurred_at: new Date().toISOString(),
  producer: 'profile-service',
  tenant_id: null,
  actor_id: null,
  correlation_id: randomUUID(),
  causation_id: null,
  trace_id: 'a'.repeat(32),
  aggregate_id: randomUUID(),
  aggregate_version: 1,
  data_classification: 'INTERNAL' as const,
  payload: {},
});

test('real PostgreSQL, Redis, JetStream, inbox/outbox and gateway', async () => {
  const nc = await connect({ servers: env.NATS_URL!, token: env.NATS_TOKEN! });
  const redis = createClient({ url: env.REDIS_URL! });
  redis.on('error', () => {});
  try {
    await pool.query(infrastructureMigration);
    await pool.query('CREATE TABLE IF NOT EXISTS infra_probe (id uuid PRIMARY KEY)');
    // Every service role must be unable to connect to every other service database.
    const catalog = JSON.parse(readFileSync('docs/architecture/service-catalog.json', 'utf8'));
    for (const service of catalog.filter((s: { database: string | null }) => s.database)) {
      const config = parseEnv(readFileSync(`/run/vianoor/${service.id}.env`, 'utf8'));
      const own = new pg.Client({ connectionString: config.DATABASE_URL });
      await own.connect();
      try {
        for (const other of catalog.filter((s: { database: string | null }) => s.database)) {
          const result = await own.query(
            'SELECT has_database_privilege(current_user, $1, $2) AS allowed',
            [other.database, 'CONNECT'],
          );
          assert.equal(result.rows[0].allowed, service.id === other.id);
        }
      } finally {
        await own.end();
      }
    }
    const forbidden = new pg.Client({
      connectionString: env.DATABASE_URL!.replace('/profile_db', '/identity_db'),
    });
    await assert.rejects(forbidden.connect(), { code: '42501' });
    await forbidden.end();
    const value = event();
    await assert.rejects(
      transaction(pool, async (c) => {
        await enqueue(c, value, 'profile-service');
        throw new Error('rollback');
      }),
    );
    assert.equal(
      (await pool.query('SELECT 1 FROM infra_outbox WHERE event_id=$1', [value.event_id])).rowCount,
      0,
    );
    await transaction(pool, (c) => enqueue(c, value, 'profile-service'));
    const manager = await nc.jetstreamManager();
    const stream = 'TEST_' + randomUUID().replaceAll('-', '');
    // Separate probe subject stream tests durable replay without touching domain events.
    await manager.streams.add({
      name: stream,
      subjects: [`test.${stream}`],
      storage: StorageType.File,
    });
    await manager.consumers.add(stream, {
      durable_name: 'probe',
      ack_policy: AckPolicy.Explicit,
      ack_wait: 1e9,
    });
    const js = nc.jetstream();
    assert.ok(await relayOnce(pool, js));
    assert.equal(
      (
        await pool.query('SELECT published_at FROM infra_outbox WHERE event_id=$1', [
          value.event_id,
        ])
      ).rows[0].published_at instanceof Date,
      true,
    );
    const handler = async (client: pg.PoolClient) => {
      await client.query('INSERT INTO infra_probe(id) VALUES ($1)', [value.event_id]);
    };
    await assert.rejects(
      consumeOnce(pool, 'rollback', value, async () => {
        throw new Error('retry');
      }),
    );
    assert.equal(
      (
        await pool.query('SELECT 1 FROM infra_inbox WHERE consumer=$1 AND event_id=$2', [
          'rollback',
          value.event_id,
        ])
      ).rowCount,
      0,
    );
    const results = await Promise.all(
      Array.from({ length: 5 }, () => consumeOnce(pool, 'duplicate', value, handler)),
    );
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(
      (await pool.query('SELECT 1 FROM infra_probe WHERE id=$1', [value.event_id])).rowCount,
      1,
    );
    await js.publish(`test.${stream}`, new TextEncoder().encode(JSON.stringify(value)));
    const consumer = await js.consumers.get(stream, 'probe');
    const first = await consumer.next({ expires: 3000 });
    assert.ok(first);
    first.nak();
    const repeated = await consumer.next({ expires: 3000 });
    assert.ok(repeated);
    assert.ok(repeated.info.redeliveryCount >= 1);
    await processMessage(pool, 'duplicate', repeated, handler);
    await nc.flush();
    await manager.streams.delete(stream);
    await redis.connect();
    const key = `infra:test:${randomUUID()}`;
    await redis.set(key, 'ok', { EX: 10 });
    assert.equal(await redis.get(key), 'ok');
    await redis.del(key);
    const response = await fetch('http://api-gateway:4100/api/v1/services/identity', {
      headers: { traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01` },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).trace_id, 'a'.repeat(32));
  } finally {
    if (redis.isOpen) redis.destroy();
    await nc.close();
    await pool.end();
  }
});
