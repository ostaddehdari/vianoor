import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
} from '@vianoor/service-runtime';
import { initializeQuestions, questionRouter } from './questions.js';
if (process.env.COMMUNICATIONS_ENABLED !== '1') await bootstrap('qa-service', 4121);
else {
  const infra = await connectInfrastructure('qa-service');
  await initializeQuestions(infra.pool!);
  const app = await createService('qa-service', {
      infrastructure: infra,
      ready: infra.healthy,
      configure: (a) => a.use(questionRouter(infra.pool!)),
    }),
    c = readRuntimeConfig(4121);
  await app.listen(c.port, c.host);
}
