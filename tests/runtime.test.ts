import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createService, readRuntimeConfig } from '../packages/service-runtime/dist/index.js';
import { healthSchema, apiErrorSchema } from '../packages/contracts/src/index.ts';
test('runtime rejects malformed ports and non-allowlisted hosts', () => {
 for(const PORT of ['0','65536','123abc','1.5','-3','']) assert.throws(()=>readRuntimeConfig(4100,{PORT}));
 assert.throws(()=>readRuntimeConfig(4100,{HOST:'external.example.com'}));
 assert.deepEqual(readRuntimeConfig(4100,{}),{port:4100,host:'127.0.0.1'});
});
test('HTTP liveness is distinct from business readiness and errors are sanitized', async () => {
 const app=await createService('test-service');
 try {
  await app.listen(0,'127.0.0.1');
  const base=await app.getUrl();
  const live=await fetch(base+'/health/live'); assert.equal(live.status,200); assert.equal(healthSchema.parse(await live.json()).status,'live');
  const ready=await fetch(base+'/health/ready'); assert.equal(ready.status,503); assert.equal(healthSchema.parse(await ready.json()).status,'not_ready');
  const info=await fetch(base+'/api/v1'); const body=await info.json(); assert.equal(body.data.service,'test-service'); assert.match(body.trace_id,/^[a-f0-9]{32}$/);
  const absent=await fetch(base+'/api/v1/unknown'); assert.equal(absent.status,404); assert.equal(apiErrorSchema.parse(await absent.json()).error.code,'NOT_FOUND');
 } finally { await app.close(); }
});
