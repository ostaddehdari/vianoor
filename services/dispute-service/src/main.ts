import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
} from '@vianoor/service-runtime';
import { initializeDisputes, disputesRouter, disputeWorker } from './disputes.js';
if (process.env.FINANCE_ENABLED !== '1') await bootstrap('dispute-service', 4118);
else {
  const infra = await connectInfrastructure('dispute-service');
  await initializeDisputes(infra.pool!);
  const app = await createService('dispute-service', {
    infrastructure: infra,
    ready: infra.healthy,
    configure: (app) => app.use(disputesRouter(infra.pool!)),
  });
  const c = readRuntimeConfig(4118);
  await app.listen(c.port, c.host);
  disputeWorker(infra.pool!);
}
