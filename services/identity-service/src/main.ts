import {
  bootstrap,
  createService,
  connectInfrastructure,
  readRuntimeConfig,
} from '@vianoor/service-runtime';
import { identityConfig } from './config.js';
import { Identity } from './identity.js';
import { identityRouter } from './http.js';
import { mailWorker } from './mail.js';
if (process.env.AUTH_ENABLED !== '1') {
  await bootstrap('identity-service', 4101);
} else {
  const config = identityConfig();
  const infra = await connectInfrastructure('identity-service');
  const identity = new Identity(infra.pool!, config);
  await identity.initialize();
  const mail = mailWorker(infra.pool!, config);
  const originalClose = infra.close;
  infra.close = async () => {
    await mail.close();
    await originalClose();
  };
  const app = await createService('identity-service', {
    infrastructure: infra,
    ready: infra.healthy,
    configure: (app) => app.use('/api/v1/auth', identityRouter(identity, infra.redis)),
  });
  const runtime = readRuntimeConfig(4101);
  await app.listen(runtime.port, runtime.host);
}
