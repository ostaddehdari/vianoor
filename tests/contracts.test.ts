import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eventEnvelopeSchema, paymentCapturedSchema, moneySchema, aiProviderConfigSchema } from '../packages/contracts/src/index.ts';
const fixture = () => ({ event_id: randomUUID(), event_type: 'payment.payment.captured.v1', event_version: 1, occurred_at: '2026-09-25T20:00:00.000Z', producer: 'payment-service', tenant_id: randomUUID(), actor_id: null, correlation_id: randomUUID(), causation_id: null, trace_id: 'a'.repeat(32), aggregate_id: randomUUID(), aggregate_version: 1, data_classification: 'PERSONAL', payload: { payment_id: randomUUID(), booking_id: randomUUID(), money: { amount_minor: '100000000000000000000', currency: 'IRR' }, provider_reference: 'demo-reference' } });
test('captured payment accepts large integer money without floating point loss', () => { const value = paymentCapturedSchema.parse(fixture()); assert.equal(value.payload.money.amount_minor, '100000000000000000000'); });
test('event version, UTC and trace are enforced', () => {
  for (const change of [{ event_version: 2 }, { occurred_at: '2026-09-25T23:30:00+03:30' }, { trace_id: '0'.repeat(32) }, { event_type: 'payment.captured' }, { aggregate_version: 0 }]) assert.equal(eventEnvelopeSchema.safeParse({ ...fixture(), ...change }).success,false);
});
test('payment cannot be produced by another service or omit tenant', () => {
  assert.equal(paymentCapturedSchema.safeParse({ ...fixture(), producer:'booking-service' }).success,false);
  assert.equal(paymentCapturedSchema.safeParse({ ...fixture(), tenant_id:null }).success,false);
});
test('money rejects decimal, negative, numeric and ambiguous currency', () => {
  for (const amount_minor of ['1.5','-1','01',1.5]) assert.equal(moneySchema.safeParse({amount_minor,currency:'IRR'}).success,false);
  assert.equal(moneySchema.safeParse({amount_minor:'10',currency:'TOMAN'}).success,false);
});
test('strict payment payload rejects accidental sensitive content', () => {
 const value = fixture(); assert.equal(paymentCapturedSchema.safeParse({...value,payload:{...value.payload,private_question:'secret'}}).success,false);
});
test('AI config uses HTTPS, model ID and secret reference; raw API key not accepted', () => {
 const value={adapter:'gapgpt',base_url:'https://api.example.com/v1',secret_ref:'secrets/ai/gapgpt',default_model_id:'configured-model',timeout_ms:10000};
 assert.equal(aiProviderConfigSchema.safeParse(value).success,true);
 for(const change of [{base_url:'http://example.com'},{base_url:'https://user:password@example.com'},{base_url:'https://example.com?key=secret'},{secret_ref:'sk-secret'},{default_model_id:''},{timeout_ms:0},{api_key:'secret'}]) assert.equal(aiProviderConfigSchema.safeParse({...value,...change}).success,false);
});
