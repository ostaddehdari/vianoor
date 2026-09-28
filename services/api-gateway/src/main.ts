import {
  bootstrap,
  createService,
  connectInfrastructure,
  readRuntimeConfig,
} from '@vianoor/service-runtime';
import { authProxy } from './auth.js';
import { usersProxy } from './users.js';
if (process.env.AUTH_ENABLED !== '1') {
  await bootstrap('api-gateway', 4100);
} else {
  const infrastructure = await connectInfrastructure('api-gateway');
  const target = process.env.IDENTITY_URL ?? 'http://identity-service:4101';
  const app = await createService('api-gateway', {
    infrastructure,
    ready: async () => {
      if (!(await infrastructure.healthy())) return false;
      try {
        return (
          await fetch(new URL('/health/ready', target), {
            signal: AbortSignal.timeout(2500),
            redirect: 'error',
          })
        ).ok;
      } catch {
        return false;
      }
    },
    gatewayTarget: target,
    configure: (app) => {
      app.use('/api/v1/auth', authProxy(target, process.env.AUTH_INTERNAL_KEY ?? ''));
      if (process.env.USERS_ENABLED === '1') app.use('/api/v2', usersProxy());
    },
  });
  const config = readRuntimeConfig(4100);
  await app.listen(config.port, config.host);
}
