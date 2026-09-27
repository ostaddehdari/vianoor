import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
  processMessage,
} from '@vianoor/service-runtime';
import { AckPolicy } from 'nats';
import { initializeSearch, rebuild, searchRouter, opensearch, alias } from './search.js';
if (process.env.DISCOVERY_ENABLED !== '1') await bootstrap('search-service', 4126);
else {
  const infra = await connectInfrastructure('search-service');
  await initializeSearch(infra.pool!);
  const manager = await infra.nc.jetstreamManager();
  try {
    await manager.consumers.info('VIANOOR', 'discovery-index');
  } catch {
    await manager.consumers.add('VIANOOR', {
      durable_name: 'discovery-index',
      ack_policy: AckPolicy.Explicit,
      filter_subject: 'vianoor.discovery.catalog.changed.v1',
      max_ack_pending: 100,
    });
  }
  const consumer = await infra.js.consumers.get('VIANOOR', 'discovery-index');
  const messages = await consumer.consume({ max_messages: 50 });
  void (async () => {
    for await (const message of messages)
      await processMessage(infra.pool!, 'discovery-index', message, async (db) => {
        await db.query('UPDATE search_state SET generation=generation+1 WHERE id=1');
      });
  })().catch(() => {});
  let stopped = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    running = Promise.resolve();
  const tick = () => {
    running = (async () => {
      await rebuild(infra.pool!);
      if (!stopped) timer = setTimeout(tick, 3000);
    })();
  };
  tick();
  const close = infra.close;
  infra.close = async () => {
    stopped = true;
    clearTimeout(timer);
    messages.stop();
    await running;
    await close();
  };
  const app = await createService('search-service', {
    infrastructure: infra,
    ready: async () => {
      try {
        return (
          (await infra.healthy()) &&
          !!(await infra.pool!.query('SELECT index_name FROM search_state WHERE id=1')).rows[0]
            ?.index_name &&
          !!(await opensearch('/' + alias + '/_count'))
        );
      } catch {
        return false;
      }
    },
    configure: (app) => app.use(searchRouter(infra.pool!, infra.redis)),
  });
  const config = readRuntimeConfig(4126);
  await app.listen(config.port, config.host);
}
