import type { Pool } from 'pg';
import { z } from 'zod';
import { ServiceError, sealJson, openJson } from '@vianoor/service-runtime';
export const smsSettings = z
  .object({
    account_sid: z.string().regex(/^AC[0-9a-f]{32}$/),
    auth_token: z.string().min(20).max(200),
    messaging_service_sid: z.string().regex(/^MG[0-9a-f]{32}$/),
    verify_service_sid: z.string().regex(/^VA[0-9a-f]{32}$/),
  })
  .strict();
export type SmsSettings = z.infer<typeof smsSettings>;
export const seal = (v: unknown, id: string) =>
  sealJson(v, 'notification:' + id, 'COMMUNICATION_ENCRYPTION_KEY');
export const open = (v: string, id: string) =>
  openJson(v, 'notification:' + id, 'COMMUNICATION_ENCRYPTION_KEY');
export async function settings(pool: Pool) {
  const row = (await pool.query('SELECT * FROM notification_settings WHERE id')).rows[0];
  if (!row?.enabled || !row.sealed_sms) throw new ServiceError(409, 'SMS_NOT_CONFIGURED');
  return smsSettings.parse(open(row.sealed_sms, 'sms'));
}
export async function twilio(
  c: SmsSettings,
  host: 'api' | 'verify',
  path: string,
  body?: Record<string, string>,
) {
  let origin = 'https://' + host + '.twilio.com';
  if (process.env.COMMUNICATIONS_ADAPTER_TEST === '1' && process.env.AUTH_DEVELOPMENT === '1') {
    const url = new URL(process.env.COMMUNICATIONS_TEST_PROVIDER_URL ?? '');
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:')
      throw new Error('Test endpoint must be loopback');
    origin = url.origin + '/' + host;
  }
  const r = await fetch(origin + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      authorization: 'Basic ' + Buffer.from(c.account_sid + ':' + c.auth_token).toString('base64'),
      ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(body ? { body: new URLSearchParams(body) } : {}),
    signal: AbortSignal.timeout(12000),
    redirect: 'error',
  });
  if (!r.ok) throw new ServiceError(r.status >= 500 ? 503 : 400, 'SMS_PROVIDER_REJECTED');
  return (await r.json()) as { sid?: string; status?: string };
}
export async function verifyPhone(pool: Pool, phone: string, code?: string) {
  const c = await settings(pool),
    path =
      '/v2/Services/' + c.verify_service_sid + (code ? '/VerificationCheck' : '/Verifications');
  const result = await twilio(
    c,
    'verify',
    path,
    code ? { To: phone, Code: code } : { To: phone, Channel: 'sms' },
  );
  if (code && result.status !== 'approved') throw new ServiceError(400, 'INVALID_VERIFICATION');
  return result;
}
