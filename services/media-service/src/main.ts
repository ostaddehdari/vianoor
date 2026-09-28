import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
} from '@vianoor/service-runtime';
import { initializeMedia } from './model.js';
import { recordingsRouter, recordingTick } from './recordings.js';
import { sessionsRouter } from './sessions.js';
import { mediaWebhook, mediaTick } from './events.js';
if (process.env.LIVE_SESSIONS_ENABLED !== '1') await bootstrap('media-service', 4111);
else {
  const infra = await connectInfrastructure('media-service');
  await initializeMedia(infra.pool!);
  const app = await createService('media-service', {
      infrastructure: infra,
      ready: infra.healthy,
      configure: (a) => {
        a.use(mediaWebhook(infra.pool!));
        a.use(sessionsRouter(infra.pool!));
        a.use(recordingsRouter(infra.pool!));
      },
    }),
    c = readRuntimeConfig(4111);
  await app.listen(c.port, c.host);
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void recordingTick(infra.pool!)
      .catch(() => {})
      .then(() => mediaTick(infra.pool!))
      .catch(() => {})
      .finally(() => {
        busy = false;
      });
  }, 5000);
  timer.unref();
}
