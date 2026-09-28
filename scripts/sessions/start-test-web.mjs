import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const config = Object.fromEntries(
  readFileSync('/run/vianoor/identity-auth.env', 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
if (config.AUTH_DEVELOPMENT !== '1' || config.AUTH_PUBLIC_URL !== 'http://127.0.0.1:18886/vianoor')
  throw Error('Isolated test web only');
const child = spawn(
  process.execPath,
  [
    'node_modules/next/dist/bin/next',
    'start',
    'apps/web',
    '--hostname',
    '0.0.0.0',
    '--port',
    '3000',
  ],
  {
    env: {
      ...process.env,
      ...config,
      AUTH_GATEWAY_URL: 'http://127.0.0.1:4100',
      NEXT_PUBLIC_BASE_PATH: '/vianoor',
      NODE_OPTIONS: '--max-old-space-size=256',
    },
    stdio: 'inherit',
  },
);
child.on('exit', (code) => process.exit(code ?? 1));
