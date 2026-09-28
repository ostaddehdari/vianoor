import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const path = 'infra/identity.compose.json',
  compose = JSON.parse(readFileSync(path, 'utf8'));
const privatePath = 'infra/local/sessions-key.env';
if (!existsSync(privatePath))
  writeFileSync(privatePath, 'SESSION_ENCRYPTION_KEY=' + randomBytes(32).toString('hex') + '\n', {
    mode: 0o600,
  });
const base = readFileSync('infra/local/communications.env', 'utf8').trim();
writeFileSync(
  'infra/local/sessions.env',
  base +
    '\nLIVE_SESSIONS_ENABLED=1\nMEDIA_SERVICE_URL=http://media-service:4111\nRATING_SERVICE_URL=http://rating-service:4122\n',
  { mode: 0o600 },
);
// Provider credentials are supplied separately; generation never enables unconfigured recording.
if (!existsSync('infra/local/livekit.env'))
  throw Error(
    'Create private infra/local/livekit.env with LIVEKIT_HTTP_URL, LIVEKIT_PUBLIC_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET and LIVEKIT_EGRESS_ENABLED=0 (or 1 only after Egress/storage acceptance).',
  );
for (const [id, s] of Object.entries(compose.services)) {
  if (!id.endsWith('-service') && id !== 'api-gateway') continue;
  if (s.profiles && !['media-service', 'rating-service'].includes(id)) continue;
  delete s.profiles;
  s.image = 'vianoor-services:stage13';
  s.env_file = s.env_file.filter(
    (f) =>
      ![
        './local/communications.env',
        './local/sessions.env',
        './local/sessions-key.env',
        './local/livekit.env',
      ].includes(typeof f === 'string' ? f : f.path),
  );
  s.env_file.push({ path: './local/sessions.env', format: 'raw' });
  if (['media-service', 'rating-service'].includes(id))
    s.env_file.push({ path: './local/sessions-key.env', format: 'raw' });
  if (id === 'media-service') s.env_file.push({ path: './local/livekit.env', format: 'raw' });
  if (id === 'file-service' && existsSync('infra/local/recordings-storage.env'))
    s.env_file.push({ path: './local/recordings-storage.env', format: 'raw' });
  if (['media-service', 'rating-service'].includes(id)) {
    const port = id === 'media-service' ? 4111 : 4122;
    s.mem_limit = '256m';
    s.healthcheck = {
      test: [
        'CMD',
        'node',
        '-e',
        `fetch('http://127.0.0.1:${port}/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`,
      ],
      interval: '15s',
      timeout: '5s',
      retries: 10,
      start_period: '30s',
    };
  }
}
compose.services['media-service'].ports = ['127.0.0.1:18893:4111'];
compose.services.web.image = 'vianoor-web:stage13';
writeFileSync(path, JSON.stringify(compose, null, 2) + '\n');
console.log(
  'Stage 13 owner configuration prepared; LiveKit/TURN/Egress and acceptance remain deployment prerequisites.',
);
