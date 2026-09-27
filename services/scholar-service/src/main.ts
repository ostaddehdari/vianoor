import {
  bootstrap,
  installChangeFeed,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
} from '@vianoor/service-runtime';
import { initializeDiscovery, discoveryRouter } from './discovery.js';
import { initializeScholars, scholarsRouter, notificationWorker } from './scholars.js';
if (process.env.SCHOLARS_ENABLED !== '1') await bootstrap('scholar-service', 4105);
else {
  const infrastructure = await connectInfrastructure('scholar-service');
  await initializeScholars(infrastructure.pool!);
  if (process.env.DISCOVERY_ENABLED === '1') {
    await initializeDiscovery(infrastructure.pool!);
    await installChangeFeed(infrastructure.pool!, 'scholar-service', [
      'scholars',
      'scholar_specialties',
      'scholar_offerings',
      'expert_translations',
      'service_translations',
    ]);
  }
  notificationWorker(infrastructure.pool!);
  const app = await createService('scholar-service', {
    infrastructure,
    ready: infrastructure.healthy,
    configure: (app) => {
      if (process.env.DISCOVERY_ENABLED === '1') app.use(discoveryRouter(infrastructure.pool!));
      app.use(scholarsRouter(infrastructure.pool!));
    },
  });
  const config = readRuntimeConfig(4105);
  await app.listen(config.port, config.host);
}
