import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
} from '@vianoor/service-runtime';
import { initializeMessaging, relayNotifications } from './model.js';
import { conversationRouter } from './conversations.js';
import { channelRouter } from './channels.js';
import { realtime } from './realtime.js';
if (process.env.COMMUNICATIONS_ENABLED !== '1') await bootstrap('messaging-service', 4112);
else {
  const infra = await connectInfrastructure('messaging-service');
  await initializeMessaging(infra.pool!);
  const rt = await realtime(infra);
  const app = await createService('messaging-service', {
    infrastructure: infra,
    ready: infra.healthy,
    configure: (app) => {
      app.use(conversationRouter(infra.pool!, rt.publish));
      app.use(channelRouter(infra.pool!));
      app.use(rt.router);
    },
  });
  const connection = rt.attach(app.getHttpServer());
  const c = readRuntimeConfig(4112);
  await app.listen(c.port, c.host);
  let busy = false;
  const worker = setInterval(() => {
    if (busy) return;
    busy = true;
    void relayNotifications(infra.pool!)
      .catch(() => {})
      .finally(() => {
        busy = false;
      });
  }, 2000);
  worker.unref();
  process.once('SIGTERM', () => {
    clearInterval(worker);
    void connection.close();
  });
}
