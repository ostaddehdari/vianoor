import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
} from '@vianoor/service-runtime';
import { initializeWallet, walletRouter } from './wallet.js';
if (process.env.FINANCE_ENABLED !== '1') await bootstrap('wallet-service', 4115);
else {
  const infra = await connectInfrastructure('wallet-service');
  await initializeWallet(infra.pool!);
  const app = await createService('wallet-service', {
    infrastructure: infra,
    ready: infra.healthy,
    configure: (app) => app.use(walletRouter(infra.pool!)),
  });
  const c = readRuntimeConfig(4115);
  await app.listen(c.port, c.host);
}
