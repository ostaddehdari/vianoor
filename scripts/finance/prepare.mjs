import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const path = 'infra/identity.compose.json',
  compose = JSON.parse(readFileSync(path, 'utf8'));
const keyPath = 'infra/local/finance-key.env';
if (!existsSync(keyPath))
  writeFileSync(keyPath, 'FINANCE_ENCRYPTION_KEY=' + randomBytes(32).toString('hex') + '\n', {
    mode: 0o600,
  });
const base = readFileSync('infra/local/discovery.env', 'utf8').trim();
const urls = ['payment:4114', 'wallet:4115', 'accounting:4116', 'payout:4117', 'dispute:4118']
  .map((s) => {
    const [name, port] = s.split(':');
    return name.toUpperCase() + '_SERVICE_URL=http://' + name + '-service:' + port;
  })
  .join('\n');
writeFileSync('infra/local/finance.env', base + '\nFINANCE_ENABLED=1\n' + urls + '\n', {
  mode: 0o600,
});
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
]) {
  const id = name === 'api-gateway' ? name : name + '-service',
    s = compose.services[id];
  delete s.profiles;
  s.image = 'vianoor-services:stage11';
  s.env_file = s.env_file.filter(
    (f) =>
      !['./local/discovery.env', './local/finance.env', './local/finance-key.env'].includes(
        typeof f === 'string' ? f : f.path,
      ),
  );
  s.env_file.push({ path: './local/finance.env', format: 'raw' });
  if (['payment', 'wallet', 'accounting', 'payout', 'dispute'].includes(name)) {
    s.env_file.push({ path: './local/finance-key.env', format: 'raw' });
    s.mem_limit = '256m';
    s.healthcheck.test = [
      'CMD',
      'node',
      '-e',
      `fetch('http://127.0.0.1:${{ payment: 4114, wallet: 4115, accounting: 4116, payout: 4117, dispute: 4118 }[name]}/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`,
    ];
  }
}
compose.services.web.image = 'vianoor-web:stage11';
compose.services.web.environment = {
  ...compose.services.web.environment,
  FINANCE_ENABLED: '1',
  FINANCE_TRUST_PROXY_IP: '1',
  PAYMENT_SERVICE_URL: 'http://payment-service:4114',
};
writeFileSync(path, JSON.stringify(compose, null, 2) + '\n');
console.log(
  'Stage 11 configured; external gateways remain disabled until the administrator configures and tests them.',
);
