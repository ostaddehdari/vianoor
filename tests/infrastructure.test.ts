import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createService, newTrace, processMessage } from '../packages/service-runtime/dist/index.js';

test('trace rejects zero and malformed parents and preserves valid trace ID', () => {
  assert.equal(newTrace(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`).traceId, 'a'.repeat(32));
  for (const value of [undefined, 'secret', `00-${'0'.repeat(32)}-${'b'.repeat(16)}-01`])
    assert.match(newTrace(value).traceId, /^(?!0{32})[a-f0-9]{32}$/);
});

test('infrastructure health recovers while domain readiness stays closed; gateway forwards trace', async () => {
  let healthy = true;
  const upstream = await createService('identity-service');
  await upstream.listen(0, '127.0.0.1');
  const gateway = await createService('api-gateway', {
    gatewayTarget: await upstream.getUrl(),
    infrastructure: { healthy: async () => healthy, close: async () => {} },
  });
  await gateway.listen(0, '127.0.0.1');
  const url = await gateway.getUrl();
  try {
    assert.equal((await fetch(url + '/health/infra')).status, 200);
    healthy = false;
    assert.equal((await fetch(url + '/health/infra')).status, 503);
    assert.equal((await fetch(url + '/health/live')).status, 200);
    assert.equal((await fetch(url + '/health/ready')).status, 503);
    healthy = true;
    assert.equal((await fetch(url + '/health/infra')).status, 200);
    const response = await fetch(url + '/api/v1/services/identity', {
      headers: { traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01` },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-trace-id'), 'a'.repeat(32));
    assert.equal((await response.json()).trace_id, 'a'.repeat(32));
    assert.equal((await fetch(url + '/api/v1/services/identity/admin')).status, 404);
    await upstream.close();
    assert.equal((await fetch(url + '/api/v1/services/identity')).status, 502);
  } finally {
    await gateway.close();
    await upstream.close();
  }
});

test('malformed event is retried without acknowledgment', async () => {
  let acked = false,
    retry = 0;
  await processMessage(
    {} as never,
    'test',
    {
      data: new TextEncoder().encode('invalid'),
      ack: () => {
        acked = true;
      },
      nak: (delay) => {
        retry = delay ?? 0;
      },
    },
    async () => {},
  );
  assert.equal(acked, false);
  assert.equal(retry, 5000);
});
