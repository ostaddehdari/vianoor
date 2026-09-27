import { readFileSync, writeFileSync } from 'node:fs';
const path = 'infra/identity.compose.json',
  compose = JSON.parse(readFileSync(path, 'utf8'));
const base = readFileSync('infra/local/scholars.env', 'utf8').trim();
writeFileSync(
  'infra/local/scheduling.env',
  base +
    '\nSCHEDULING_ENABLED=1\nAVAILABILITY_SERVICE_URL=http://availability-service:4106\nBOOKING_SERVICE_URL=http://booking-service:4109\n',
  { mode: 0o600 },
);
for (const name of [
  'identity-service',
  'organization-service',
  'profile-service',
  'file-service',
  'consent-service',
  'booking-service',
  'scholar-service',
  'taxonomy-service',
  'availability-service',
  'api-gateway',
]) {
  const service = compose.services[name];
  delete service.profiles;
  service.image = 'vianoor-services:stage9';
  service.env_file = service.env_file.filter(
    (f) =>
      !['./local/scholars.env', './local/scheduling.env'].includes(
        typeof f === 'string' ? f : f.path,
      ),
  );
  service.env_file.push({ path: './local/scheduling.env', format: 'raw' });
  if (name === 'availability-service') service.mem_limit = '384m';
}
compose.services.web.image = 'vianoor-web:stage9';
if (process.env.SCHEDULING_TEST === '1') {
  if (compose.name !== 'vianoor-stage8-test')
    throw Error('Prepare isolated scholar test environment first.');
  compose.name = 'vianoor-stage9-test';
  compose.services['scholars-test'].image = 'vianoor-services:stage9';
  compose.services['scheduling-test'] = {
    ...compose.services['scholars-test'],
    environment: { SCHEDULING_TEST: '1' },
    command: ['node', '--import', 'tsx', '--test', 'tests/integration/scheduling.test.ts'],
  };
}
writeFileSync(path, JSON.stringify(compose, null, 2) + '\n');
console.log('Stage 9 configuration prepared; existing secrets preserved.');
