import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { roles, copy, pagePaths, routeInfo } from '../packages/ui/src/routing.ts';
test('all twelve role previews exist in both apps', () => {
  assert.equal(roles.length, 12);
  assert.equal(new Set(roles.map((r) => r.id)).size, 12);
  for (const app of ['web', 'admin'] as const)
    for (const role of roles) {
      assert.ok(pagePaths(app).includes(`preview/${role.id}`));
      assert.equal(routeInfo(`preview/${role.id}`, app)?.role, role.id);
    }
});
test('localized UI copy has matching nonempty keys', () => {
  assert.deepEqual(Object.keys(copy.fa).sort(), Object.keys(copy.en).sort());
  for (const dict of Object.values(copy))
    for (const value of Object.values(dict)) assert.ok(value.trim());
});
test('page registry copy stays synchronized and routes reject arbitrary slugs', () => {
  assert.deepEqual(
    JSON.parse(readFileSync('docs/design/pages.json', 'utf8')),
    JSON.parse(readFileSync('packages/ui/src/page-registry.json', 'utf8')),
  );
  for (const app of ['web', 'admin'] as const) {
    const paths = pagePaths(app);
    assert.equal(paths.length, new Set(paths).size);
    for (const p of paths) assert.ok(routeInfo(p, app));
  }
  for (const p of ['not-real', 'experts/unknown', 'preview/finance/delete-all', 'preview/unknown'])
    assert.equal(routeInfo(p), null);
});
