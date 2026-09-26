import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  passwordHash,
  passwordVerify,
  encrypt,
  decrypt,
  equalSecret,
  rateLimit,
} from '../services/identity-service/src/security.ts';
import { identityConfig } from '../services/identity-service/src/config.ts';
test('Argon2id uses independent salts and verifies only the right password', async () => {
  const a = await passwordHash('a long sample password'),
    b = await passwordHash('a long sample password');
  assert.match(a, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.notEqual(a, b);
  assert.equal(await passwordVerify(a, 'a long sample password'), true);
  assert.equal(await passwordVerify(a, 'a wrong sample password'), false);
});
test('mail tokens use authenticated encryption; tampering and other keys fail', () => {
  const key = randomBytes(32),
    value = encrypt({ token: 'sample-secret' }, key);
  assert.equal(value.includes('sample-secret'), false);
  assert.deepEqual(decrypt(value, key), { token: 'sample-secret' });
  assert.throws(() => decrypt(value, randomBytes(32)));
  const altered = Buffer.from(value, 'base64');
  altered[20] ^= 1;
  assert.throws(() => decrypt(altered.toString('base64'), key));
  assert.equal(equalSecret('one', 'two'), false);
  assert.equal(equalSecret('one', 'one'), true);
});
test('rate limiter denies over budget and does not expose identifiers in Redis keys', async () => {
  const redis = {
    async eval(_script: string, options: { keys: string[] }) {
      assert.equal(options.keys[0]?.includes('person@example.test'), false);
      return 5;
    },
  };
  await assert.rejects(rateLimit(redis, 'person@example.test', 4), { code: 'RATE_LIMITED' });
});
test('production identity rejects insecure origins and short secrets', () => {
  const env = {
    AUTH_PUBLIC_URL: 'https://example.test/vianoor',
    AUTH_INTERNAL_KEY: 'a'.repeat(64),
    AUTH_MAIL_KEY: 'b'.repeat(64),
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '587',
    SMTP_FROM: 'auth@example.test',
  };
  assert.equal(identityConfig(env).smtp.requireTLS, true);
  assert.throws(() => identityConfig({ ...env, AUTH_PUBLIC_URL: 'http://example.test' }));
  assert.throws(() => identityConfig({ ...env, AUTH_INTERNAL_KEY: 'short' }));
  assert.throws(() =>
    identityConfig({ ...env, AUTH_PUBLIC_URL: 'https://example.test/?redirect=bad' }),
  );
});
