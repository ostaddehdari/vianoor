import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
} from '@vianoor/service-runtime';
import { initializeFiles, filesRouter } from './files.js';
if (process.env.USERS_ENABLED !== '1') await bootstrap('file-service', 4113);
else {
  const infrastructure = await connectInfrastructure('file-service');
  await initializeFiles(infrastructure.pool!);
  const app = await createService('file-service', {
    infrastructure,
    ready: infrastructure.healthy,
    configure: (app) => app.use(filesRouter(infrastructure.pool!)),
  });
  const config = readRuntimeConfig(4113);
  await app.listen(config.port, config.host);
}
