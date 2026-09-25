import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const catalog = JSON.parse(readFileSync('docs/architecture/service-catalog.json', 'utf8'));
async function probe(child, url, verify) {
  let lastError;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Process exited: ${child.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      await verify(response);
      return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError;
}
async function stop(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 3000).unref();
  });
}
for (const [index, service] of catalog.entries()) {
  const port = 15100 + index;
  const child = spawn(process.execPath, [`services/${service.id}/dist/main.js`], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: 'pipe',
  });
  try {
    await probe(child, `http://127.0.0.1:${port}/health/live`, async (r) => {
      assert.equal(r.status, 200);
      assert.equal((await r.json()).service, service.id);
    });
    const ready = await fetch(`http://127.0.0.1:${port}/health/ready`);
    assert.equal(ready.status, 503);
    console.log(`PASS ${service.id}: live=200, ready=503 (scaffold)`);
  } finally {
    await stop(child);
  }
}
for (const [index, name] of ['web', 'admin'].entries()) {
  const port = 15300 + index;
  const child = spawn(
    process.execPath,
    ['../../node_modules/next/dist/bin/next', 'start', '-p', String(port)],
    { cwd: `apps/${name}`, stdio: 'pipe' },
  );
  try {
    for (const [locale, dir] of [
      ['fa', 'rtl'],
      ['en', 'ltr'],
    ])
      await probe(child, `http://127.0.0.1:${port}/${locale}`, async (r) => {
        assert.equal(r.status, 200);
        const html = await r.text();
        assert.ok(html.includes(`lang="${locale}"`));
        assert.ok(html.includes(`dir="${dir}"`));
        assert.ok(html.includes('id="main"'));
      });
    const root = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' });
    assert.equal(root.status, 307);
    assert.equal(root.headers.get('location'), '/fa');
    const invalid = await fetch(`http://127.0.0.1:${port}/de`);
    assert.equal(invalid.status, 404);
    console.log(`PASS ${name}: fa/en, direction, redirect, invalid locale`);
  } finally {
    await stop(child);
  }
}
