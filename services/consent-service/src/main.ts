import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
} from '@vianoor/service-runtime';
import { initializeConsent, consentRouter } from './consent.js';
if (process.env.USERS_ENABLED !== '1') await bootstrap('consent-service', 4124);
else {
  const infrastructure = await connectInfrastructure('consent-service');
  await initializeConsent(infrastructure.pool!);
  const app = await createService('consent-service', {
    infrastructure,
    ready: infrastructure.healthy,
    configure: (app) => app.use(consentRouter(infrastructure.pool!)),
  });
  const config = readRuntimeConfig(4124);
  await app.listen(config.port, config.host);
}
