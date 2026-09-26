import { execFileSync } from 'node:child_process';
const args = ['compose', '-f', 'infra/compose.json'];
const compose = (...command) => execFileSync('docker', [...args, ...command], { stdio: 'inherit' });
const probe = (path, expected) =>
  execFileSync(
    'docker',
    [
      ...args,
      'exec',
      '-T',
      'api-gateway',
      'node',
      '-e',
      `fetch('http://127.0.0.1:4100/${path}').then(r=>process.exit(r.status===${expected}?0:1)).catch(()=>process.exit(1))`,
    ],
    { stdio: 'pipe' },
  );
async function until(fn) {
  for (let i = 0; i < 40; i++) {
    try {
      fn();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('Infrastructure recovery timeout');
}
compose(
  'exec',
  '-T',
  'postgres',
  'psql',
  '-U',
  'postgres',
  '-d',
  'profile_db',
  '-c',
  'CREATE TABLE IF NOT EXISTS infra_restart_probe (id integer PRIMARY KEY); INSERT INTO infra_restart_probe VALUES (1) ON CONFLICT DO NOTHING',
);
for (const dependency of ['redis', 'nats']) {
  compose('stop', dependency);
  try {
    await until(() => probe('health/infra', 503));
    probe('health/live', 200);
  } finally {
    compose('start', dependency);
  }
  await until(() => probe('health/infra', 200));
}
compose('restart', 'postgres', 'redis', 'nats', 'identity-service', 'api-gateway');
await until(() => probe('health/infra', 200));
await until(() => probe('api/v1/services/identity', 200));
compose(
  'exec',
  '-T',
  'postgres',
  'psql',
  '-U',
  'postgres',
  '-d',
  'profile_db',
  '-v',
  'ON_ERROR_STOP=1',
  '-c',
  "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM infra_restart_probe WHERE id=1) THEN RAISE EXCEPTION 'lost data'; END IF; END $$",
);
console.log('PASS restart persistence, dependency failure and recovery');
