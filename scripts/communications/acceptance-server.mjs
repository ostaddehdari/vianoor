import { readFileSync } from 'node:fs';
const read = (name) =>
  Object.fromEntries(
    readFileSync('/run/vianoor/' + name + '.env', 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i), l.slice(i + 1)];
      }),
  );
const base = {
  ...read('identity-auth'),
  ...read('users'),
  ...read('scheduling'),
  ...read('storage'),
};
if (base.AUTH_DEVELOPMENT !== '1' || base.AUTH_PUBLIC_URL !== 'http://127.0.0.1:18886/vianoor')
  throw Error('Isolated test environment required');
Object.assign(process.env, base, {
  COMMUNICATIONS_ENABLED: '1',
  COMMUNICATION_ENCRYPTION_KEY: '9'.repeat(64),
  FINANCE_ENABLED: '1',
  FINANCE_ENCRYPTION_KEY: '8'.repeat(64),
});
const catalog = JSON.parse(readFileSync('docs/architecture/service-catalog.json', 'utf8')),
  urls = Object.fromEntries(
    catalog.map((s) => [
      s.id.toUpperCase().replaceAll('-', '_') + '_URL',
      'http://127.0.0.1:' + s.port,
    ]),
  );
for (const name of [
  'identity',
  'organization',
  'profile',
  'file',
  'consent',
  'taxonomy',
  'scholar',
  'availability',
  'booking',
  'accounting',
  'wallet',
  'payment',
  'payout',
  'dispute',
  'messaging',
  'presence',
  'qa',
  'notification',
  'api-gateway',
]) {
  const id = name === 'api-gateway' ? name : name + '-service';
  delete process.env.DATABASE_URL;
  Object.assign(process.env, read(id), base, urls, {
    IDENTITY_URL: 'http://127.0.0.1:4101',
    DISCOVERY_ENABLED: '1',
    FINANCE_ENABLED: '1',
    COMMUNICATIONS_ENABLED: '1',
    PORT: String(catalog.find((s) => s.id === id).port),
    HOST: '0.0.0.0',
  });
  await import('../../services/' + id + '/src/main.ts');
}
console.log('Stage 12 acceptance owners started with isolated databases.');
