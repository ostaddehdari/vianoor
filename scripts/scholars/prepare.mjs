import { readFileSync, writeFileSync, existsSync, chownSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
const path = 'infra/identity.compose.json';
const compose = JSON.parse(readFileSync(path, 'utf8'));
const base = readFileSync('infra/local/users.env', 'utf8').trim();
const settings =
  base +
  '\nSCHOLARS_ENABLED=1\nSCHOLAR_SERVICE_URL=http://scholar-service:4105\nTAXONOMY_SERVICE_URL=http://taxonomy-service:4104\n';
writeFileSync('infra/local/scholars.env', settings, { mode: 0o600 });
if (!existsSync('infra/local/storage.env')) {
  const access = randomBytes(16).toString('hex'),
    secret = randomBytes(32).toString('hex');
  writeFileSync(
    'infra/local/storage.env',
    `S3_ENDPOINT=http://object-storage:8333\nS3_BUCKET=vianoor-private\nS3_ACCESS_KEY=${access}\nS3_SECRET_KEY=${secret}\nS3_CREATE_BUCKET=1\nCLAMD_HOST=scanner\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    'infra/local/s3.json',
    JSON.stringify({
      identities: [
        {
          name: 'vianoor-file-service',
          credentials: [{ accessKey: access, secretKey: secret }],
          actions: ['Admin', 'Read', 'Write', 'List'],
        },
      ],
    }) + '\n',
    { mode: 0o600 },
  );
}
if (process.platform === 'linux' && process.getuid?.() === 0)
  chownSync('infra/local/s3.json', 1000, 1000);
for (const name of [
  'api-gateway',
  'identity-service',
  'organization-service',
  'profile-service',
  'file-service',
  'consent-service',
  'booking-service',
  'scholar-service',
  'taxonomy-service',
]) {
  const service = compose.services[name];
  delete service.profiles;
  service.image = 'vianoor-services:stage8';
  service.env_file = service.env_file.filter(
    (f) =>
      !['./local/scholars.env', './local/storage.env'].includes(typeof f === 'string' ? f : f.path),
  );
  service.env_file.push({ path: './local/scholars.env', format: 'raw' });
  if (name === 'file-service')
    service.env_file.push({ path: './local/storage.env', format: 'raw' });
  service.mem_limit =
    name === 'file-service' ? '512m' : name === 'identity-service' ? '512m' : '256m';
}
compose.services['object-storage'] = {
  image: 'chrislusf/seaweedfs:4.47',
  command: [
    'server',
    '-dir=/data',
    '-s3',
    '-s3.config=/etc/seaweedfs/s3.json',
    '-ip=object-storage',
    '-ip.bind=0.0.0.0',
    '-volume.max=16',
    '-master.volumeSizeLimitMB=256',
    '-master.telemetry=false',
  ],
  networks: ['backend'],
  volumes: ['objects:/data', './local/s3.json:/etc/seaweedfs/s3.json:ro'],
  restart: 'unless-stopped',
  mem_limit: '384m',
  healthcheck: {
    test: ['CMD', 'nc', '-z', '127.0.0.1', '8333'],
    interval: '10s',
    timeout: '5s',
    retries: 15,
  },
  logging: { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '2' } },
};
compose.services.scanner = {
  image: 'clamav/clamav:1.4.3',
  networks: ['backend'],
  volumes: ['scan-signatures:/var/lib/clamav'],
  restart: 'unless-stopped',
  mem_limit: '1800m',
  environment: { CLAMAV_NO_FRESHCLAMD: 'false' },
  logging: { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '2' } },
};
compose.volumes.objects = {};
compose.volumes['scan-signatures'] = {};
compose.services['file-service'].depends_on['object-storage'] = { condition: 'service_healthy' };
compose.services.web.image = 'vianoor-web:stage8';
compose.services['scholars-test'] = {
  image: 'vianoor-services:stage8',
  profiles: ['test'],
  user: '0:0',
  networks: ['backend'],
  volumes: ['./local:/run/vianoor:ro', './qa:/test-output'],
  environment: { SCHOLARS_TEST: '1' },
  command: ['node', '--import', 'tsx', '--test', 'tests/integration/scholars.test.ts'],
};
if (process.env.SCHOLARS_TEST === '1') {
  // Isolated-test signature for a harmless PDF. Stock EICAR is tested separately as its exact 68-byte format.
  const fixture = Buffer.from('%PDF-1.4\nVIANOOR-ANTIVIRUS-INTEGRATION-TEST\n%%EOF');
  writeFileSync(
    'infra/local/stage08-test.hdb',
    `${createHash('md5').update(fixture).digest('hex')}:${fixture.length}:Vianoor.Stage08.HarmlessTest\n`,
    { mode: 0o644 },
  );
  compose.services.scanner.volumes.push(
    './local/stage08-test.hdb:/var/lib/clamav/stage08-test.hdb:ro',
  );
  const identity = readFileSync('infra/local/identity-auth.env', 'utf8');
  if (
    !identity.includes('AUTH_DEVELOPMENT=1') ||
    !identity.includes('AUTH_PUBLIC_URL=http://127.0.0.1:18886/vianoor')
  )
    throw Error('An isolated stage 8 test configuration is required');
  compose.name = 'vianoor-stage8-test';
  compose.services.web.ports = ['127.0.0.1:18886:3000'];
  compose.services['api-gateway'].ports = ['127.0.0.1:18885:4100'];
  compose.services.mailpit.ports = ['127.0.0.1:18887:8025'];
}
writeFileSync(path, JSON.stringify(compose, null, 2) + '\n');
console.log('Stage 8 configuration saved. Secrets stay in infra/local.');
