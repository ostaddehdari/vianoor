import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
} from '@vianoor/service-runtime';

import {
  eventWorker,
  initializeWebinars,
  webinarRouter,
} from './webinars.js';

if (
  process.env.EVENTS_ENABLED !==
  '1'
)
  await bootstrap(
    'event-service',
    4120,
  );
else {
  const infra =
    await connectInfrastructure(
      'event-service',
    );

  await initializeWebinars(
    infra.pool!,
  );

  const app =
      await createService(
        'event-service',
        {
          infrastructure:
            infra,

          ready:
            infra.healthy,

          configure:
            (
              application,
            ) => {
              application.use(
                webinarRouter(
                  infra.pool!,
                ),
              );
            },
        },
      ),

    config =
      readRuntimeConfig(
        4120,
      );

  await app.listen(
    config.port,
    config.host,
  );

  const timer =
    eventWorker(
      infra.pool!,
    );

  process.once(
    'SIGTERM',
    () => {
      clearInterval(
        timer,
      );
    },
  );
}
