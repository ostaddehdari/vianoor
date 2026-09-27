import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
} from '@vianoor/service-runtime';
import { initializeTaxonomy, taxonomyRouter } from './taxonomy.js';
if (process.env.SCHOLARS_ENABLED !== '1') await bootstrap('taxonomy-service', 4104);
else {
  const infrastructure = await connectInfrastructure('taxonomy-service');
  await initializeTaxonomy(infrastructure.pool!);
  const app = await createService('taxonomy-service', {
    infrastructure,
    ready: infrastructure.healthy,
    configure: (app) => app.use(taxonomyRouter(infrastructure.pool!)),
  });
  const config = readRuntimeConfig(4104);
  await app.listen(config.port, config.host);
}
