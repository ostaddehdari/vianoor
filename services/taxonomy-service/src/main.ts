import { specialtyTranslationsRouter } from './specialty-translations.js';
import {
  bootstrap,
  connectInfrastructure,
  createService,
  readRuntimeConfig,
  installChangeFeed,
} from '@vianoor/service-runtime';
import { initializeTaxonomy, taxonomyRouter } from './taxonomy.js';
import { initializeLocalization, localizationRouter } from './localization.js';
if (process.env.SCHOLARS_ENABLED !== '1') await bootstrap('taxonomy-service', 4104);
else {
  const infrastructure = await connectInfrastructure('taxonomy-service');
  await initializeTaxonomy(infrastructure.pool!);
  if (process.env.DISCOVERY_ENABLED === '1') {
    await initializeLocalization(infrastructure.pool!);
    await infrastructure.pool!.query(
      'DROP TRIGGER IF EXISTS infra_discovery_changed ON translations; DROP TRIGGER IF EXISTS infra_discovery_changed ON translation_keys',
    );
    await installChangeFeed(infrastructure.pool!, 'taxonomy-service', [
      'taxonomy_entries',
      'languages',
      'specialty_translations',
    ]);
  }
  const app = await createService('taxonomy-service', {
    infrastructure,
    ready: infrastructure.healthy,
    configure: (app) => {
      app.use(taxonomyRouter(infrastructure.pool!));
      if (process.env.DISCOVERY_ENABLED === '1') {
        app.use(localizationRouter(infrastructure.pool!));
        app.use(specialtyTranslationsRouter(infrastructure.pool!));
      }
    },
  });
  const config = readRuntimeConfig(4104);
  await app.listen(config.port, config.host);
}
