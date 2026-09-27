import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
} from '@vianoor/service-runtime';
import { initializeLedger, ledgerRouter } from './ledger.js';
if (process.env.FINANCE_ENABLED !== '1') await bootstrap('accounting-service', 4116);
else {
  const infra = await connectInfrastructure('accounting-service');
  await initializeLedger(infra.pool!);
  const app = await createService('accounting-service', {
    infrastructure: infra,
    ready: infra.healthy,
    configure: (app) => app.use(ledgerRouter(infra.pool!)),
  });
  const c = readRuntimeConfig(4116);
  await app.listen(c.port, c.host);
}
