import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
} from '@vianoor/service-runtime';
import { initializeOrganization, organizationRouter } from './organization.js';
if (process.env.USERS_ENABLED !== '1') await bootstrap('organization-service', 4103);
else {
  const infrastructure = await connectInfrastructure('organization-service');
  await initializeOrganization(infrastructure.pool!);
  const app = await createService('organization-service', {
    infrastructure,
    ready: infrastructure.healthy,
    configure: (app) => app.use(organizationRouter(infrastructure.pool!)),
  });
  const config = readRuntimeConfig(4103);
  await app.listen(config.port, config.host);
}
