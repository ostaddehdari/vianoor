import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
} from '@vianoor/service-runtime';
import { initializePayouts, payoutRouter, payoutWorker } from './payouts.js';
if (process.env.FINANCE_ENABLED !== '1') await bootstrap('payout-service', 4117);
else {
  const infra = await connectInfrastructure('payout-service');
  await initializePayouts(infra.pool!);
  const app = await createService('payout-service', {
    infrastructure: infra,
    ready: infra.healthy,
    configure: (app) => app.use(payoutRouter(infra.pool!)),
  });
  const c = readRuntimeConfig(4117);
  await app.listen(c.port, c.host);
  payoutWorker(infra.pool!);
}
