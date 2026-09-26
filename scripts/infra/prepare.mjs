import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const catalog = JSON.parse(readFileSync('docs/architecture/service-catalog.json', 'utf8'));
const dir = 'infra/local';
if (existsSync(dir)) throw new Error('infra/local exists; preserve credentials and volumes.');
mkdirSync(dir, { recursive: true, mode: 0o700 });
const save = (name, content) =>
  writeFileSync(`${dir}/${name}`, content, { mode: name.endsWith('.env') ? 0o600 : 0o644 });
const secret = () => randomBytes(32).toString('hex');
const admin = secret(),
  redis = secret(),
  nats = secret();
save('postgres-password', admin);
save('redis.conf', `appendonly yes\nappendfsync everysec\nrequirepass ${redis}\nbind 0.0.0.0\n`);
save(
  'nats.conf',
  `port: 4222\nhttp_port: 8222\nauthorization { token: "${nats}" }\njetstream { store_dir: "/data", max_file_store: 1073741824 }\n`,
);
const init = [
  'REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;',
  'REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;',
];
for (const service of catalog) {
  const password = secret();
  if (service.database) {
    init.push(
      `CREATE ROLE ${service.databaseRole} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE;`,
      `CREATE DATABASE ${service.database} OWNER ${service.databaseRole};`,
      `REVOKE ALL ON DATABASE ${service.database} FROM PUBLIC;`,
      `\\connect ${service.database}`,
      'REVOKE CREATE ON SCHEMA public FROM PUBLIC;',
    );
  }
  save(
    `${service.id}.env`,
    [
      'INFRA_ENABLED=1',
      'HOST=0.0.0.0',
      `PORT=${service.port}`,
      ...(service.database
        ? [
            `DATABASE_URL=postgresql://${service.databaseRole}:${password}@postgres:5432/${service.database}`,
          ]
        : []),
      `REDIS_URL=redis://:${redis}@redis:6379`,
      'NATS_URL=nats://nats:4222',
      `NATS_TOKEN=${nats}`,
    ].join('\n') + '\n',
  );
}
save('init.sql', init.join('\n') + '\n');
console.log('Generated private infrastructure credentials; existing files are never overwritten.');
