import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { twilio, smsSettings, seal, open } from '../services/notification-service/src/sms.js';
import { messageInput } from '../services/messaging-service/src/model.js';
import { communicationCopy } from '../packages/ui/src/communication-copy.js';
test('communication locale parity and strict attachment/voice contracts', () => {
  assert.deepEqual(
    Object.keys(communicationCopy.fa!).sort(),
    Object.keys(communicationCopy.en!).sort(),
  );
  const base = {
    request_key: '10000000-0000-4000-8000-000000000001',
    type: 'VOICE',
    files: ['10000000-0000-4000-8000-000000000002'],
  };
  assert.equal(messageInput.safeParse(base).success, false);
  assert.equal(messageInput.safeParse({ ...base, duration: 601 }).success, false);
  assert.equal(messageInput.safeParse({ ...base, duration: 10 }).success, true);
  assert.equal(
    messageInput.safeParse({ ...base, type: 'TEXT', files: [], content: '' }).success,
    false,
  );
  assert.equal(
    messageInput.safeParse({ ...base, duration: 10, account_id: 'forged' }).success,
    false,
  );
});
test('communication encrypted fields reject tampering and a different record context', () => {
  const prev = process.env.COMMUNICATION_ENCRYPTION_KEY;
  process.env.COMMUNICATION_ENCRYPTION_KEY = 'b'.repeat(64);
  try {
    const ciphertext = seal({ text: 'synthetic secret' }, 'one');
    assert.ok(!ciphertext.includes('synthetic'));
    assert.deepEqual(open(ciphertext, 'one'), { text: 'synthetic secret' });
    assert.throws(() => open(ciphertext, 'two'));
    assert.throws(() => open(ciphertext.slice(0, -4) + 'AAAA', 'one'));
  } finally {
    if (prev === undefined) delete process.env.COMMUNICATION_ENCRYPTION_KEY;
    else process.env.COMMUNICATION_ENCRYPTION_KEY = prev;
  }
});
test(
  'Twilio adapter contract: form encoding, authentication, verification, delivery and failure',
  { timeout: 15000 },
  async () => {
    const settings = smsSettings.parse({
      account_sid: 'AC' + 'a'.repeat(32),
      auth_token: 'synthetic-token-only-123456',
      messaging_service_sid: 'MG' + 'b'.repeat(32),
      verify_service_sid: 'VA' + 'c'.repeat(32),
    });
    const requests: { url: string; body: URLSearchParams }[] = [];
    const server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      assert.equal(
        req.headers.authorization,
        'Basic ' + Buffer.from(settings.account_sid + ':' + settings.auth_token).toString('base64'),
      );
      requests.push({ url: req.url!, body: new URLSearchParams(body) });
      res.setHeader('content-type', 'application/json');
      if (req.url!.endsWith('/reject')) {
        res.statusCode = 400;
        res.end('{}');
      } else
        res.end(
          JSON.stringify({
            sid: 'SM' + 'd'.repeat(32),
            status: req.url!.includes('VerificationCheck') ? 'approved' : 'delivered',
          }),
        );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const names = [
      'COMMUNICATIONS_ADAPTER_TEST',
      'AUTH_DEVELOPMENT',
      'COMMUNICATIONS_TEST_PROVIDER_URL',
    ];
    const previous = names.map((n) => process.env[n]);
    Object.assign(process.env, {
      COMMUNICATIONS_ADAPTER_TEST: '1',
      AUTH_DEVELOPMENT: '1',
      COMMUNICATIONS_TEST_PROVIDER_URL: 'http://127.0.0.1:' + address.port,
    });
    try {
      const sent = await twilio(
        settings,
        'api',
        '/2010-04-01/Accounts/' + settings.account_sid + '/Messages.json',
        {
          To: '+12025550123',
          MessagingServiceSid: settings.messaging_service_sid,
          Body: 'Synthetic only',
        },
      );
      assert.equal(sent.status, 'delivered');
      assert.equal(requests[0]!.body.get('To'), '+12025550123');
      const verified = await twilio(
        settings,
        'verify',
        '/v2/Services/' + settings.verify_service_sid + '/VerificationCheck',
        { To: '+12025550123', Code: '123456' },
      );
      assert.equal(verified.status, 'approved');
      assert.match(requests[1]!.url, /^\/verify\/v2\//);
      await assert.rejects(twilio(settings, 'api', '/reject'), { code: 'SMS_PROVIDER_REJECTED' });
      process.env.COMMUNICATIONS_TEST_PROVIDER_URL = 'http://example.test';
      await assert.rejects(twilio(settings, 'api', '/reject'), /loopback/);
    } finally {
      names.forEach((n, i) => {
        if (previous[i] === undefined) delete process.env[n];
        else process.env[n] = previous[i];
      });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
