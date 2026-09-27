// Resource-constrained acceptance harness: real owner HTTP servers and separate
// PostgreSQL databases, Redis and NATS; only the OS process is shared for the test.
import { readFileSync } from 'node:fs';
const read = (name) =>
  Object.fromEntries(
    readFileSync('/run/vianoor/' + name + '.env', 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i), line.slice(i + 1)];
      }),
  );
const base = {
  ...read('identity-auth'),
  ...read('users'),
  ...read('scheduling'),
  ...read('storage'),
};
if (base.AUTH_DEVELOPMENT !== '1' || base.AUTH_PUBLIC_URL !== 'http://127.0.0.1:18886/vianoor')
  throw Error('Isolated test configuration required');
const catalog = JSON.parse(readFileSync('docs/architecture/service-catalog.json', 'utf8'));
const names = [
  'identity-service',
  'organization-service',
  'profile-service',
  'file-service',
  'consent-service',
  'taxonomy-service',
  'scholar-service',
  'availability-service',
  'booking-service',
  'search-service',
  'matching-service',
  'api-gateway',
];
const urls = Object.fromEntries(
  catalog.map((s) => [
    s.id.toUpperCase().replaceAll('-', '_') + '_URL',
    'http://127.0.0.1:' + s.port,
  ]),
);
for (const name of names) {
  delete process.env.DATABASE_URL;
  Object.assign(process.env, read(name), base, urls, {
    IDENTITY_URL: 'http://127.0.0.1:4101',
    DISCOVERY_ENABLED: '1',
    OPENSEARCH_URL: 'http://demo-opensearch:9200',
    SEARCH_INDEX_PREFIX: 'acceptance-expert-search',
    PORT: String(catalog.find((s) => s.id === name).port),
    HOST: '0.0.0.0',
  });
  await import('../../services/' + name + '/src/main.ts');
}
console.log('Isolated acceptance owner APIs ready.');
