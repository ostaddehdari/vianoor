import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { internalRouter } from '../packages/service-runtime/dist/index.js';
test('internal authentication preserves health probes and still protects root and prefix-mounted API routes', async () => {
  const original = process.env.AUTH_INTERNAL_KEY;
  const key = 'test-internal-key-'.repeat(4);
  process.env.AUTH_INTERNAL_KEY = key;
  const app = express();
  app.use(internalRouter());
  app.get('/health/live', (_req, res) => res.json({ ok: true }));
  app.get('/api/v2/probe', (_req, res) => res.json({ ok: true }));
  const mounted = express();
  mounted.use('/api/v2', internalRouter('64kb', true));
  mounted.get('/api/v2/probe', (_req, res) => res.json({ ok: true }));
  if (original === undefined) delete process.env.AUTH_INTERNAL_KEY;
  else process.env.AUTH_INTERNAL_KEY = original;
  for (const target of [app, mounted]) {
    const server = target.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      if (target === app) assert.equal((await fetch(base + '/health/live')).status, 200);
      assert.equal((await fetch(base + '/api/v2/probe')).status, 401);
      assert.equal(
        (await fetch(base + '/api/v2/probe', { headers: { 'x-internal-key': key } })).status,
        200,
      );
      assert.equal((await fetch(base + '/internal/anything')).status, target === app ? 401 : 404);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  }
});
