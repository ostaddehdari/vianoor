import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
} from '@vianoor/service-runtime';
import { initializeAvailability, availabilityRouter } from './availability.js';
if (process.env.SCHEDULING_ENABLED !== '1') await bootstrap('availability-service', 4106);
else {
  const infrastructure = await connectInfrastructure('availability-service');
  await initializeAvailability(infrastructure.pool!);
  const app = await createService('availability-service', {
    infrastructure,
    ready: infrastructure.healthy,
    configure: (app) => app.use(availabilityRouter(infrastructure.pool!)),
  });
  const config = readRuntimeConfig(4106);
  await app.listen(config.port, config.host);
}
