import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const path = 'infra/identity.compose.json',
  compose = JSON.parse(readFileSync(path, 'utf8'));
const keyPath = 'infra/local/communication-key.env';
if (!existsSync(keyPath))
  writeFileSync(keyPath, 'COMMUNICATION_ENCRYPTION_KEY=' + randomBytes(32).toString('hex') + '\n', {
    mode: 0o600,
  });
const ports = { messaging: 4112, presence: 4107, qa: 4121, notification: 4125 };
const base = readFileSync('infra/local/finance.env', 'utf8').trim();
writeFileSync(
  'infra/local/communications.env',
  base +
    '\nCOMMUNICATIONS_ENABLED=1\n' +
    Object.entries(ports)
      .map(
        ([name, port]) => name.toUpperCase() + '_SERVICE_URL=http://' + name + '-service:' + port,
      )
      .join('\n') +
    '\n',
  { mode: 0o600 },
);
for (const name of [
  'identity',
  'organization',
  'profile',
  'file',
  'consent',
  'booking',
  'scholar',
  'taxonomy',
  'availability',
  'search',
  'matching',
  'payment',
  'wallet',
  'accounting',
  'payout',
  'dispute',
  'api-gateway',
  ...Object.keys(ports),
]) {
  const id = name === 'api-gateway' ? name : name + '-service',
    s = compose.services[id];
  if (!s) throw Error('Missing owner ' + id);
  delete s.profiles;
  s.image = 'vianoor-services:stage12';
  s.env_file = s.env_file.filter(
    (f) =>
      ![
        './local/finance.env',
        './local/communications.env',
        './local/communication-key.env',
      ].includes(typeof f === 'string' ? f : f.path),
  );
  s.env_file.push({ path: './local/communications.env', format: 'raw' });
  if (['messaging', 'qa', 'notification'].includes(name))
    s.env_file.push({ path: './local/communication-key.env', format: 'raw' });
  if (ports[name]) {
    s.mem_limit = '256m';
    s.healthcheck = {
      test: [
        'CMD',
        'node',
        '-e',
        `fetch('http://127.0.0.1:${ports[name]}/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`,
      ],
      interval: '15s',
      timeout: '5s',
      retries: 10,
      start_period: '30s',
    };
  }
}
compose.services['messaging-service'].ports = ['127.0.0.1:18892:4112'];
compose.services.web.image = 'vianoor-web:stage12';
writeFileSync(path, JSON.stringify(compose, null, 2) + '\n');
console.log(
  'Stage 12 owners configured; preserve communication-key.env in secure backups. SMS stays disabled until configured.',
);
