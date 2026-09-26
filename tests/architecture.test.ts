import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSpecifiers, boundaryViolation } from '../scripts/import-boundaries.mjs';
import { messages } from '../packages/ui/src/messages.ts';
test('static, dynamic and require domain imports are detected', () => {
  const imports = importSpecifiers(
    `import x from '@vianoor/booking-service'; export * from '../../payment-service/src/main'; const a = import('@vianoor/payment-service'); const b = require('@vianoor/wallet-service');`,
  );
  assert.equal(imports.length, 4);
  for (const specifier of imports)
    assert.ok(boundaryViolation('services/qa-service/src/main.ts', specifier));
});
test('computed imports fail closed', () => {
  assert.ok(
    boundaryViolation('services/qa-service/src/main.ts', importSpecifiers('import(variable)')[0]),
  );
});
test('technical imports and local imports are permitted', () => {
  assert.equal(boundaryViolation('services/qa-service/src/main.ts', '@vianoor/contracts'), null);
  assert.equal(boundaryViolation('services/qa-service/src/main.ts', './module.js'), null);
  assert.ok(boundaryViolation('apps/web/app/page.tsx', '@vianoor/service-runtime'));
});
test('locale dictionaries have the same nonempty keys', () => {
  assert.deepEqual(Object.keys(messages.fa).sort(), Object.keys(messages.en).sort());
  for (const locale of Object.values(messages))
    for (const value of Object.values(locale)) assert.ok(value.trim().length > 0);
});
