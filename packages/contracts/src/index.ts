import { z } from 'zod';

export const localeSchema = z.enum(['fa', 'en']);
export type Locale = z.infer<typeof localeSchema>;
export const classificationSchema = z.enum([
  'PUBLIC',
  'INTERNAL',
  'PERSONAL',
  'SENSITIVE',
  'HIGHLY_SENSITIVE',
]);
export const moneySchema = z.strictObject({
  amount_minor: z.string().regex(/^(0|[1-9][0-9]*)$/),
  currency: z.enum(['IRR', 'USD', 'EUR', 'GBP', 'AED']),
});
export type Money = z.infer<typeof moneySchema>;
export const identifierSchema = z.string().uuid();
export const eventEnvelopeSchema = z
  .strictObject({
    event_id: identifierSchema,
    event_type: z
      .string()
      .regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.v[1-9][0-9]*$/),
    event_version: z.number().int().positive(),
    occurred_at: z.string().datetime({ offset: false }),
    producer: z.string().regex(/^[a-z][a-z0-9-]+$/),
    tenant_id: identifierSchema.nullable(),
    actor_id: identifierSchema.nullable(),
    correlation_id: identifierSchema,
    causation_id: identifierSchema.nullable(),
    trace_id: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .refine((v) => v !== '0'.repeat(32)),
    aggregate_id: identifierSchema,
    aggregate_version: z.number().int().positive(),
    data_classification: classificationSchema,
    payload: z.record(z.string(), z.unknown()),
  })
  .superRefine((event, ctx) => {
    if (!event.event_type.endsWith(`.v${event.event_version}`)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Event name/version mismatch',
        path: ['event_version'],
      });
    }
  });
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export const capturedPaymentPayloadSchema = z.strictObject({
  payment_id: identifierSchema,
  booking_id: identifierSchema,
  money: moneySchema,
  provider_reference: z.string().min(1).max(128),
});
export const paymentCapturedSchema = eventEnvelopeSchema.safeExtend({
  event_type: z.literal('payment.payment.captured.v1'),
  event_version: z.literal(1),
  producer: z.literal('payment-service'),
  tenant_id: identifierSchema,
  payload: capturedPaymentPayloadSchema,
});

export const apiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()),
  }),
  trace_id: z.string().regex(/^[a-f0-9]{32}$/),
});
export const healthSchema = z.strictObject({
  status: z.enum(['live', 'not_ready']),
  service: z.string(),
  stage: z.literal('scaffold'),
});
export const aiCapabilitySchema = z.enum([
  'TRANSLATION',
  'CLASSIFICATION',
  'SUMMARIZATION',
  'EMBEDDING',
  'SPEECH_TO_TEXT',
  'ANSWER_ASSISTANCE',
]);
export const aiRouteSchema = z.strictObject({
  provider_id: identifierSchema,
  capability: aiCapabilitySchema,
  model_id: z.string().trim().min(1).max(200),
  external_ai_allowed: z.boolean(),
});
// Configuration contract only. SSRF/egress and secret resolution belong to stage 7.
export const aiProviderConfigSchema = z.strictObject({
  adapter: z.literal('gapgpt'),
  base_url: z
    .string()
    .url()
    .refine((value) => {
      const u = new URL(value);
      return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash;
    }),
  secret_ref: z.string().regex(/^secrets\/[a-zA-Z0-9/_-]+$/),
  default_model_id: z.string().trim().min(1).max(200),
  timeout_ms: z.number().int().min(1000).max(120000),
});
