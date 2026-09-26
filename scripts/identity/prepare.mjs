import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const dir = 'infra/local';
if (!existsSync(`${dir}/identity-service.env`))
  throw Error('Run infra:prepare first in a separate installation directory.');
if (existsSync(`${dir}/identity-auth.env`))
  throw Error('Identity configuration exists; preserve keys.');
const dev = process.env.AUTH_DEVELOPMENT === '1';
const publicUrl =
  process.env.AUTH_PUBLIC_URL ?? (dev ? 'http://127.0.0.1:15400/vianoor' : undefined);
if (!publicUrl) throw Error('AUTH_PUBLIC_URL is required');
const url = new URL(publicUrl);
if (!dev && url.protocol !== 'https:') throw Error('HTTPS is required');
if (dev && !['localhost', '127.0.0.1'].includes(url.hostname))
  throw Error('Development mode is restricted to loopback public URLs');
const key = randomBytes(32).toString('hex'),
  mailKey = randomBytes(32).toString('hex');
const value = (name, fallback) => process.env[name] ?? fallback;
const smtp = {
  SMTP_HOST: value('SMTP_HOST', dev ? 'mailpit' : undefined),
  SMTP_PORT: value('SMTP_PORT', dev ? '1025' : undefined),
  SMTP_FROM: value('SMTP_FROM', dev ? 'Vianoor <no-reply@example.test>' : undefined),
  ...(process.env.SMTP_USER
    ? { SMTP_USER: process.env.SMTP_USER, SMTP_PASSWORD: process.env.SMTP_PASSWORD }
    : {}),
};
for (const [name, v] of Object.entries(smtp))
  if (!v || /[\r\n]/.test(v)) throw Error(`Invalid configuration: ${name}`);
const save = (name, data) =>
  writeFileSync(
    `${dir}/${name}`,
    Object.entries(data)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n',
    { mode: 0o600 },
  );
save('identity-auth.env', {
  AUTH_ENABLED: '1',
  AUTH_PUBLIC_URL: publicUrl,
  AUTH_INTERNAL_KEY: key,
  AUTH_MAIL_KEY: mailKey,
  AUTH_DEVELOPMENT: dev ? '1' : '0',
  ...smtp,
});
save('gateway-auth.env', {
  AUTH_ENABLED: '1',
  AUTH_INTERNAL_KEY: key,
  IDENTITY_URL: 'http://identity-service:4101',
});
save('web-auth.env', {
  AUTH_PUBLIC_URL: publicUrl,
  AUTH_INTERNAL_KEY: key,
  AUTH_GATEWAY_URL: 'http://api-gateway:4100',
  AUTH_DEVELOPMENT: dev ? '1' : '0',
});
const base = JSON.parse(readFileSync('infra/compose.json', 'utf8'));
for (const name of ['api-gateway', 'identity-service']) {
  base.services[name].image = 'vianoor-services:stage4';
  base.services[name].env_file.push({
    path: `./local/${name === 'api-gateway' ? 'gateway' : 'identity'}-auth.env`,
    format: 'raw',
  });
  base.services[name].mem_limit = '512m';
}
base.name = 'vianoor-stage4';
base.services['api-gateway'].ports = ['127.0.0.1:${VIANOOR_AUTH_GATEWAY_PORT:-18873}:4100'];
base.services.web = {
  build: {
    context: '..',
    dockerfile: 'infra/web.Dockerfile',
    args: { NEXT_PUBLIC_BASE_PATH: url.pathname.replace(/\/$/, '') },
  },
  image: 'vianoor-web:stage4',
  env_file: [{ path: './local/web-auth.env', format: 'raw' }],
  ports: ['127.0.0.1:${VIANOOR_AUTH_WEB_PORT:-18874}:3000'],
  depends_on: {
    'identity-service': { condition: 'service_healthy' },
    'api-gateway': { condition: 'service_healthy' },
  },
  networks: ['backend'],
  restart: 'unless-stopped',
  init: true,
  mem_limit: '512m',
  logging: { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } },
};
if (dev)
  base.services.mailpit = {
    image: 'axllent/mailpit:v1.31.2',
    networks: ['backend'],
    restart: 'unless-stopped',
  };
base.services.test.image = 'vianoor-services:stage4';
base.services['identity-test'] = {
  ...base.services.test,
  command: ['node', '--import', 'tsx', '--test', 'tests/integration/identity.test.ts'],
  environment: { AUTH_TEST: '1' },
  depends_on: { ...base.services.test.depends_on, web: { condition: 'service_started' } },
};
// Generated deployment configuration stays outside Git together with its secrets.
writeFileSync('infra/identity.compose.json', JSON.stringify(base, null, 2) + '\n');
console.log('Identity configuration generated. Keep infra/local and its keys private.');
