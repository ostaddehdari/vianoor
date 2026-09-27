import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
} from '@vianoor/service-runtime';
import { initializeScholars, scholarsRouter, notificationWorker } from './scholars.js';
if (process.env.SCHOLARS_ENABLED !== '1') await bootstrap('scholar-service', 4105);
else {
  const infrastructure = await connectInfrastructure('scholar-service');
  await initializeScholars(infrastructure.pool!);
  notificationWorker(infrastructure.pool!);
  const app = await createService('scholar-service', {
    infrastructure,
    ready: infrastructure.healthy,
    configure: (app) => app.use(scholarsRouter(infrastructure.pool!)),
  });
  const config = readRuntimeConfig(4105);
  await app.listen(config.port, config.host);
}
