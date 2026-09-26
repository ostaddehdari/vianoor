import {
  createHash,
  randomBytes,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import * as argon2 from 'argon2';
export const token = () => randomBytes(32).toString('base64url');
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export const passwordHash = (s: string) =>
  argon2.hash(s, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const passwordVerify = (hash: string, value: string) => argon2.verify(hash, value);
export function equalSecret(a: string, b: string) {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}
export function encrypt(value: unknown, key: Buffer) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
export function decrypt(value: string, key: Buffer) {
  const b = Buffer.from(value, 'base64'),
    cipher = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  cipher.setAuthTag(b.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString('utf8'),
  );
}
export class AuthError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export interface RateStore {
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}
export async function rateLimit(redis: RateStore, key: string, maximum: number, seconds = 900) {
  const count = Number(
    await redis.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
      { keys: ['identity:rate:' + digest(key)], arguments: [String(seconds)] },
    ),
  );
  if (count > maximum) throw new AuthError(429, 'RATE_LIMITED');
}
