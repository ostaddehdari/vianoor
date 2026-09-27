import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
} from '@vianoor/service-runtime';
import {
  initializeNotifications,
  notificationRouter,
  deliverNotifications,
} from './notifications.js';
if (process.env.COMMUNICATIONS_ENABLED !== '1') await bootstrap('notification-service', 4125);
else {
  const infra = await connectInfrastructure('notification-service');
  await initializeNotifications(infra.pool!);
  const app = await createService('notification-service', {
      infrastructure: infra,
      ready: infra.healthy,
      configure: (a) => a.use(notificationRouter(infra)),
    }),
    c = readRuntimeConfig(4125);
  await app.listen(c.port, c.host);
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void deliverNotifications(infra.pool!)
      .catch(() => {})
      .finally(() => {
        busy = false;
      });
  }, 5000);
  timer.unref();
}
