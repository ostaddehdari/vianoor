import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { journalInput, validateJournal } from '../services/accounting-service/src/ledger.js';
import {
  decimal,
  toMinor,
  verifyWebhook,
  type Gateway,
} from '../services/payment-service/src/providers.js';
import { sealJson, openJson } from '@vianoor/service-runtime';
test('money conversions preserve integer precision and reject sub-minor amounts', () => {
  assert.equal(decimal('123456789012345678901', 18), '123.456789012345678901');
  assert.equal(toMinor('123.456789012345678901', 18), '123456789012345678901');
  assert.equal(toMinor('1', 2), '100');
  assert.throws(() => toMinor('0.001', 2));
  assert.throws(() => toMinor('1e10', 2));
});
test('journals balance per currency and reject negative or two-sided lines', () => {
  const reference = randomUUID(),
    owner = randomUUID(),
    base = {
      key: 'test-journal',
      reference,
      description: 'TOPUP',
      metadata: {},
      lines: [
        { owner: null, kind: 'PROVIDER', currency: 'USD', debit: '100', credit: '0' },
        { owner, kind: 'AVAILABLE', currency: 'USD', debit: '0', credit: '100' },
      ],
    };
  validateJournal(journalInput.parse(base));
  assert.throws(() =>
    validateJournal(
      journalInput.parse({
        ...base,
        lines: [base.lines[0], { ...base.lines[1], currency: 'EUR' }],
      }),
    ),
  );
  assert.throws(() =>
    journalInput.parse({ ...base, lines: [{ ...base.lines[0], debit: '-1' }, base.lines[1]] }),
  );
  assert.throws(() =>
    validateJournal(
      journalInput.parse({ ...base, lines: [{ ...base.lines[0], credit: '1' }, base.lines[1]] }),
    ),
  );
});
test('sealed financial secrets bind to their record and reject tampering', () => {
  process.env.FINANCE_ENCRYPTION_KEY = '7'.repeat(64);
  const sealed = sealJson({ key: 'synthetic' }, 'gateway:test');
  assert.deepEqual(openJson(sealed, 'gateway:test'), { key: 'synthetic' });
  assert.throws(() => openJson(sealed, 'gateway:other'));
  const parts = sealed.split('.');
  parts[2] = Buffer.alloc(16).toString('base64');
  assert.throws(() => openJson(parts.join('.'), 'gateway:test'));
});
test('Stripe signatures require raw body and a recent signed timestamp', async () => {
  const g: Gateway = {
      id: randomUUID(),
      provider: 'stripe',
      mode: 'TEST',
      credentials: { webhook_secret: 'synthetic-signing-key' },
    },
    raw = JSON.stringify({
      id: 'evt_test',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test', object: 'checkout.session' } },
    }),
    time = String(Math.floor(Date.now() / 1000)),
    sig = createHmac('sha256', g.credentials.webhook_secret!)
      .update(time + '.' + raw)
      .digest('hex');
  assert.equal(
    (await verifyWebhook(g, raw, { 'stripe-signature': `t=${time},v1=${sig}` })).reference,
    'cs_test',
  );
  await assert.rejects(() =>
    verifyWebhook(g, raw + ' ', { 'stripe-signature': `t=${time},v1=${sig}` }),
  );
  await assert.rejects(() => verifyWebhook(g, raw, { 'stripe-signature': `t=1,v1=${sig}` }));
});
test('crypto IPN signatures use canonical sorted JSON', async () => {
  const g: Gateway = {
      id: randomUUID(),
      provider: 'nowpayments',
      mode: 'TEST',
      credentials: { ipn_secret: 'synthetic-ipn-key' },
    },
    raw = '{"payment_status":"finished","payment_id":123}',
    canonical = '{"payment_id":123,"payment_status":"finished"}',
    sig = createHmac('sha512', g.credentials.ipn_secret!).update(canonical).digest('hex');
  assert.equal((await verifyWebhook(g, raw, { 'x-nowpayments-sig': sig })).reference, '123');
  await assert.rejects(() => verifyWebhook(g, raw, { 'x-nowpayments-sig': '0'.repeat(128) }));
});
