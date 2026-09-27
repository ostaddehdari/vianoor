import {
  bootstrap,
  installChangeFeed,
  createService,
  connectInfrastructure,
  readRuntimeConfig,
} from '@vianoor/service-runtime';
import { identityConfig } from './config.js';
import { Identity } from './identity.js';
import { identityRouter } from './http.js';
import { mailWorker } from './mail.js';
import { equalSecret } from './security.js';
import { Router } from 'express';
import { usersRouter } from './users.js';
if (process.env.AUTH_ENABLED !== '1') {
  await bootstrap('identity-service', 4101);
} else {
  const config = identityConfig();
  const infra = await connectInfrastructure('identity-service');
  const identity = new Identity(infra.pool!, config);
  await identity.initialize();
  if (process.env.DISCOVERY_ENABLED === '1')
    await installChangeFeed(infra.pool!, 'identity-service', ['identity_accounts']);
  const mail = mailWorker(infra.pool!, config);
  const originalClose = infra.close;
  infra.close = async () => {
    await mail.close();
    await originalClose();
  };
  const app = await createService('identity-service', {
    infrastructure: infra,
    ready: infra.healthy,
    configure: (app) => {
      const status = Router();
      status.get('/', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        if (!equalSecret(req.get('x-internal-key') ?? '', config.apiKey)) {
          res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
          return;
        }
        try {
          res.json(await mail.inspect());
        } catch {
          res.status(503).json({ error: { code: 'UNAVAILABLE' } });
        }
      });
      app.use('/internal/mail-status', status);
      app.use('/api/v1/auth', identityRouter(identity, infra.redis));
      if (process.env.USERS_ENABLED === '1') app.use(usersRouter(identity));
    },
  });
  const runtime = readRuntimeConfig(4101);
  await app.listen(runtime.port, runtime.host);
}
