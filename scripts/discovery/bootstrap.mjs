import { readFileSync } from 'node:fs';
const items = JSON.parse(readFileSync(new URL('./ui-seed.json', import.meta.url), 'utf8'));
const key = process.env.AUTH_INTERNAL_KEY;
if (!key || key.length < 48) throw Error('Internal key required');
for (let offset = 0; offset < items.length; offset += 100) {
  const response = await fetch(
    (process.env.TAXONOMY_SERVICE_URL ?? 'http://taxonomy-service:4104') +
      '/internal/localization/bootstrap',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': key },
      body: JSON.stringify({ items: items.slice(offset, offset + 100) }),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok) throw Error('Bootstrap failed: ' + response.status);
}
console.log('UI bootstrap complete:', items.length, 'keys; existing edits preserved.');
