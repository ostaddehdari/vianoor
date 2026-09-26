import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
} from '@vianoor/service-runtime';
import { initializeProfile, profileRouter } from './profile.js';
if (process.env.USERS_ENABLED !== '1') await bootstrap('profile-service', 4102);
else {
  const infrastructure = await connectInfrastructure('profile-service');
  await initializeProfile(infrastructure.pool!);
  const app = await createService('profile-service', {
    infrastructure,
    ready: infrastructure.healthy,
    configure: (app) => app.use(profileRouter(infrastructure.pool!)),
  });
  const config = readRuntimeConfig(4102);
  await app.listen(config.port, config.host);
}
