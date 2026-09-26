import { readFileSync, writeFileSync } from 'node:fs';
const catalog = JSON.parse(readFileSync('docs/architecture/service-catalog.json', 'utf8'));
const healthy = { condition: 'service_healthy' };
const services = {
  postgres: {
    image: 'postgres:17.6-bookworm',
    environment: { POSTGRES_PASSWORD_FILE: '/run/secrets/postgres-password' },
    volumes: [
      'postgres:/var/lib/postgresql/data',
      './local/init.sql:/docker-entrypoint-initdb.d/01-services.sql:ro',
      './local/postgres-password:/run/secrets/postgres-password:ro',
    ],
    healthcheck: {
      test: ['CMD-SHELL', 'pg_isready -U postgres'],
      interval: '5s',
      timeout: '3s',
      retries: 30,
    },
  },
  redis: {
    image: 'redis:7.4.6-alpine',
    command: ['redis-server', '/etc/redis/redis.conf'],
    volumes: ['redis:/data', './local/redis.conf:/etc/redis/redis.conf:ro'],
    healthcheck: {
      test: [
        'CMD-SHELL',
        'REDISCLI_AUTH=$(sed -n "s/^requirepass //p" /etc/redis/redis.conf) redis-cli ping | grep -q PONG',
      ],
      interval: '5s',
      timeout: '3s',
      retries: 20,
    },
  },
  nats: {
    image: 'nats:2.11.9-alpine',
    command: ['-c', '/etc/nats/nats.conf'],
    volumes: ['nats:/data', './local/nats.conf:/etc/nats/nats.conf:ro'],
    healthcheck: {
      test: [
        'CMD',
        'wget',
        '-q',
        '-O',
        '/dev/null',
        'http://127.0.0.1:8222/healthz?js-enabled-only=true',
      ],
      interval: '5s',
      timeout: '3s',
      retries: 20,
    },
  },
};
for (const s of catalog)
  services[s.id] = {
    build: { context: '..', dockerfile: 'infra/Dockerfile' },
    image: 'vianoor-services:stage2',
    command: ['node', `services/${s.id}/dist/main.js`],
    env_file: [`./local/${s.id}.env`],
    depends_on: { postgres: healthy, redis: healthy, nats: healthy },
    ...(s.id === 'api-gateway' ? { ports: ['127.0.0.1:${VIANOOR_GATEWAY_PORT:-18871}:4100'] } : {}),
    ...(!['api-gateway', 'identity-service'].includes(s.id) ? { profiles: ['all'] } : {}),
    healthcheck: {
      test: [
        'CMD',
        'node',
        '-e',
        `fetch('http://127.0.0.1:${s.port}/health/infra').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`,
      ],
      interval: '10s',
      timeout: '5s',
      retries: 15,
    },
    init: true,
    mem_limit: '256m',
    pids_limit: 128,
  };
services.test = {
  image: 'vianoor-services:stage2',
  profiles: ['test'],
  user: '0:0',
  volumes: ['./local:/run/vianoor:ro'],
  command: ['node', '--import', 'tsx', '--test', 'tests/integration/infra.test.ts'],
  depends_on: { 'api-gateway': healthy, 'identity-service': healthy },
  environment: { INFRA_TEST: '1' },
};
for (const [name, service] of Object.entries(services)) {
  service.networks = ['backend'];
  if (name !== 'test') service.restart = 'unless-stopped';
  service.logging = { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } };
}
writeFileSync(
  'infra/compose.json',
  JSON.stringify(
    {
      name: 'vianoor-stage2',
      services,
      networks: { backend: {} },
      volumes: { postgres: {}, redis: {}, nats: {} },
    },
    null,
    2,
  ) + '\n',
);
