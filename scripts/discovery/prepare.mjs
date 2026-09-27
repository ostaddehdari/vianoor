import { readFileSync, writeFileSync } from 'node:fs';
const path = 'infra/identity.compose.json',
  compose = JSON.parse(readFileSync(path, 'utf8'));
const base = readFileSync('infra/local/scheduling.env', 'utf8').trim();
writeFileSync(
  'infra/local/discovery.env',
  base +
    '\nDISCOVERY_ENABLED=1\nSEARCH_SERVICE_URL=http://search-service:4126\nMATCHING_SERVICE_URL=http://matching-service:4108\nOPENSEARCH_URL=http://opensearch:9200\n',
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
  'search-service',
  'matching-service',
  'api-gateway',
]) {
  const service = compose.services[name];
  delete service.profiles;
  service.image = 'vianoor-services:stage10';
  service.env_file = service.env_file.filter(
    (f) =>
      !['./local/scheduling.env', './local/discovery.env'].includes(
        typeof f === 'string' ? f : f.path,
      ),
  );
  service.env_file.push({ path: './local/discovery.env', format: 'raw' });
  if (['search-service', 'matching-service'].includes(name)) service.mem_limit = '384m';
}
compose.services.opensearch = {
  image: 'opensearchproject/opensearch:2.19.6',
  environment: {
    'discovery.type': 'single-node',
    'bootstrap.memory_lock': 'true',
    DISABLE_INSTALL_DEMO_CONFIG: 'true',
    DISABLE_SECURITY_PLUGIN: 'true',
    OPENSEARCH_JAVA_OPTS: '-Xms512m -Xmx512m',
  },
  ulimits: { memlock: { soft: -1, hard: -1 }, nofile: { soft: 65536, hard: 65536 } },
  networks: ['backend'],
  volumes: ['search-index:/usr/share/opensearch/data'],
  mem_limit: '1400m',
  restart: 'unless-stopped',
  healthcheck: {
    test: ['CMD-SHELL', 'curl -fsS http://localhost:9200/_cluster/health | grep -q status'],
    interval: '10s',
    timeout: '5s',
    retries: 30,
  },
  logging: { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '2' } },
};
compose.volumes['search-index'] = {};
if (process.env.OPENSEARCH_BASELINE_RUNTIME) {
  const runtime = process.env.OPENSEARCH_BASELINE_RUNTIME;
  if (!runtime.startsWith('/opt/vianoor-')) throw Error('Unexpected baseline runtime');
  Object.assign(compose.services.opensearch, {
    image: 'node:24.19.0-bookworm-slim',
    user: '1000:1000',
    working_dir: '/usr/share/opensearch',
    command: ['/usr/share/opensearch/bin/opensearch'],
    environment: {
      OPENSEARCH_JAVA_HOME: '/usr/share/opensearch/jdk',
      OPENSEARCH_JAVA_OPTS: '-Xms512m -Xmx512m',
    },
    volumes: [runtime + ':/usr/share/opensearch', 'search-index:/usr/share/opensearch/data'],
    healthcheck: {
      test: [
        'CMD',
        'node',
        '-e',
        "fetch('http://127.0.0.1:9200/_cluster/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
      ],
      interval: '10s',
      timeout: '5s',
      retries: 30,
    },
  });
}
compose.services['search-service'].healthcheck.test = [
  'CMD',
  'node',
  '-e',
  "fetch('http://127.0.0.1:4126/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
];
compose.services.web.image = 'vianoor-web:stage10';
compose.services.web.environment = { ...compose.services.web.environment, DISCOVERY_ENABLED: '1' };
if (process.env.DISCOVERY_TEST === '1') {
  if (!['vianoor-stage9-test', 'vianoor-stage10-test'].includes(compose.name))
    throw Error('Isolated stage 9 test configuration required');
  // Reuse the isolated test volumes; never production volumes or credentials.
  compose.services['discovery-test'] = {
    ...compose.services['scheduling-test'],
    image: 'vianoor-services:stage10',
    environment: { DISCOVERY_TEST: '1' },
    command: ['node', '--import', 'tsx', '--test', 'tests/integration/discovery.test.ts'],
  };
  for (const name of ['scholars-test', 'scheduling-test'])
    compose.services[name].image = 'vianoor-services:stage10';
}
writeFileSync(path, JSON.stringify(compose, null, 2) + '\n');
console.log('Stage 10 configuration prepared. OpenSearch is internal only.');
