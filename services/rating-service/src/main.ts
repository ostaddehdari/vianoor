import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
} from '@vianoor/service-runtime';
import { initializeRatings, ratingsRouter } from './ratings.js';
if (process.env.LIVE_SESSIONS_ENABLED !== '1') await bootstrap('rating-service', 4122);
else {
  const infra = await connectInfrastructure('rating-service');
  await initializeRatings(infra.pool!);
  const app = await createService('rating-service', {
      infrastructure: infra,
      ready: infra.healthy,
      configure: (a) => a.use(ratingsRouter(infra.pool!)),
    }),
    c = readRuntimeConfig(4122);
  await app.listen(c.port, c.host);
}
