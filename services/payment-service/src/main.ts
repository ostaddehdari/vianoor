import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
} from '@vianoor/service-runtime';
import { initializeRisk, riskRouter } from './risk.js';
import { initializeProviderPayouts, providerPayoutRouter } from './payout-provider.js';
import { initializePayments, paymentsRouter, financeWorker } from './payments.js';
if (process.env.FINANCE_ENABLED !== '1') await bootstrap('payment-service', 4114);
else {
  const infra = await connectInfrastructure('payment-service');
  await initializePayments(infra.pool!);
  await initializeProviderPayouts(infra.pool!);
  await initializeRisk(infra.pool!);
  const app = await createService('payment-service', {
    infrastructure: infra,
    ready: infra.healthy,
    configure: (app) => {
      app.use(paymentsRouter(infra.pool!));
      app.use(providerPayoutRouter(infra.pool!));
      app.use(riskRouter(infra.pool!));
    },
  });
  const c = readRuntimeConfig(4114);
  await app.listen(c.port, c.host);
  financeWorker(infra.pool!);
}
