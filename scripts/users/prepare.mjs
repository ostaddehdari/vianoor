import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const file = 'infra/identity.compose.json';
if (!existsSync(file)) throw Error('Prepare identity infrastructure first.');
const env = Object.fromEntries(
  readFileSync('infra/local/identity-auth.env', 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);
if (!env.AUTH_INTERNAL_KEY || env.AUTH_INTERNAL_KEY.length < 48)
  throw Error('Identity key missing');
const services = {
  'identity-service': 4101,
  'organization-service': 4103,
  'profile-service': 4102,
  'file-service': 4113,
  'consent-service': 4124,
  'booking-service': 4109,
};
const settings = {
  USERS_ENABLED: '1',
  AUTH_INTERNAL_KEY: env.AUTH_INTERNAL_KEY,
  ...Object.fromEntries(
    Object.entries(services).map(([name, port]) => [
      name.toUpperCase().replaceAll('-', '_') + '_URL',
      `http://${name}:${port}`,
    ]),
  ),
};
writeFileSync(
  'infra/local/users.env',
  Object.entries(settings)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n',
  { mode: 0o600 },
);
const compose = JSON.parse(readFileSync(file, 'utf8'));
for (const name of ['api-gateway', ...Object.keys(services)]) {
  const service = compose.services[name];
  service.image = 'vianoor-services:stage6';
  delete service.profiles;
  service.env_file = service.env_file.filter(
    (f) => (typeof f === 'string' ? f : f.path) !== './local/users.env',
  );
  service.env_file.push({ path: './local/users.env', format: 'raw' });
  service.mem_limit = name === 'identity-service' ? '512m' : '256m';
  if (name !== 'identity-service' && name !== 'api-gateway')
    service.depends_on['identity-service'] = { condition: 'service_healthy' };
}
compose.services['file-service'].volumes = ['avatars:/var/lib/vianoor/avatars'];
compose.volumes.avatars = {};
compose.services.web.image = 'vianoor-web:stage6';
compose.services['users-test'] = {
  image: 'vianoor-services:stage6',
  profiles: ['test'],
  user: '0:0',
  networks: ['backend'],
  volumes: ['./local:/run/vianoor:ro', './qa:/test-output'],
  environment: { USERS_TEST: '1' },
  command: ['node', '--import', 'tsx', '--test', 'tests/integration/users.test.ts'],
};
if (process.env.USERS_TEST === '1') {
  if (env.AUTH_DEVELOPMENT !== '1')
    throw Error('Test deployment requires isolated development configuration');
  compose.name = 'vianoor-stage6-test';
  compose.services.web.ports = ['127.0.0.1:18876:3000'];
  compose.services['api-gateway'].ports = ['127.0.0.1:18875:4100'];
  compose.services.mailpit.ports = ['127.0.0.1:18877:8025'];
}
writeFileSync(file, JSON.stringify(compose, null, 2) + '\n');
console.log('Stage 6 configured. Credentials remain in infra/local.');
