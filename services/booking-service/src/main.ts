import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
} from '@vianoor/service-runtime';
import { initializeRequests, requestsRouter } from './requests.js';
import { initializeScheduling, schedulingRouter, schedulingWorker } from './scheduling.js';
if (process.env.USERS_ENABLED !== '1') await bootstrap('booking-service', 4109);
else {
  const infrastructure = await connectInfrastructure('booking-service');
  await initializeRequests(infrastructure.pool!);
  if (process.env.SCHEDULING_ENABLED === '1') {
    await initializeScheduling(infrastructure.pool!);
    schedulingWorker(infrastructure.pool!);
  }
  const app = await createService('booking-service', {
    infrastructure,
    ready: infrastructure.healthy,
    configure: (app) => {
      app.use(requestsRouter(infrastructure.pool!));
      if (process.env.SCHEDULING_ENABLED === '1') app.use(schedulingRouter(infrastructure.pool!));
    },
  });
  const config = readRuntimeConfig(4109);
  await app.listen(config.port, config.host);
}
