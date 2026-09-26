import pg from 'pg';
import { createClient } from 'redis';
import { connect, StorageType, RetentionPolicy } from 'nats';
import { infrastructureMigration, relayOnce } from './messaging.js';

export async function connectInfrastructure(service: string, env = process.env) {
  if (!env.REDIS_URL || !env.NATS_URL || !env.NATS_TOKEN)
    throw new Error('Infrastructure configuration incomplete');
  if (service !== 'api-gateway' && !env.DATABASE_URL) throw new Error('Service database missing');
  const pool = env.DATABASE_URL
    ? new pg.Pool({
        connectionString: env.DATABASE_URL,
        max: 3,
        connectionTimeoutMillis: 2000,
        query_timeout: 3000,
        statement_timeout: 3000,
      })
    : undefined;
  pool?.on('error', () => {});
  const redis = createClient({
    url: env.REDIS_URL,
    disableOfflineQueue: true,
    socket: { connectTimeout: 2000, reconnectStrategy: (retries) => Math.min(100 * retries, 2000) },
  });
  redis.on('error', () => {});
  const nc = await connect({
    servers: env.NATS_URL,
    token: env.NATS_TOKEN,
    timeout: 2000,
    maxReconnectAttempts: -1,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running: Promise<void> = Promise.resolve();
  async function close() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    await running;
    await Promise.allSettled([pool?.end(), redis.isOpen ? redis.destroy() : undefined, nc.close()]);
  }
  try {
    await redis.connect();
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(202602)');
        await client.query(infrastructureMigration);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    const manager = await nc.jetstreamManager();
    try {
      await manager.streams.info('VIANOOR');
    } catch (error) {
      if ((error as { code?: string }).code !== '404') throw error;
      try {
        await manager.streams.add({
          name: 'VIANOOR',
          subjects: ['vianoor.>'],
          storage: StorageType.File,
          retention: RetentionPolicy.Limits,
          max_age: 7 * 86400 * 1e9,
          max_bytes: 512 * 1024 * 1024,
          duplicate_window: 120 * 1e9,
        });
      } catch {
        await manager.streams.info('VIANOOR');
      }
    }
    const js = nc.jetstream();
    const tick = () => {
      running = (async () => {
        if (pool) {
          try {
            await relayOnce(pool, js);
          } catch {
            /* Retry without logging private event payload. */
          }
        }
        if (!stopped) timer = setTimeout(tick, 1000);
      })();
    };
    tick();
    return {
      pool,
      js,
      nc,
      redis,
      close,
      async healthy() {
        try {
          await Promise.all([
            pool?.query('SELECT 1'),
            redis.ping(),
            manager.streams.info('VIANOOR'),
          ]);
          return !nc.isClosed();
        } catch {
          return false;
        }
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
