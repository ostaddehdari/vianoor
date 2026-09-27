import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
function encryptionKey() {
  const value = process.env.FINANCE_ENCRYPTION_KEY ?? '';
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('Finance encryption key missing');
  return Buffer.from(value, 'hex');
}
export function sealJson(value: unknown, context: string) {
  const nonce = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', encryptionKey(), nonce);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [
    'v1',
    nonce.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    body.toString('base64'),
  ].join('.');
}
export function openJson(value: string, context: string): unknown {
  const [version, nonce, tag, body] = value.split('.');
  if (version !== 'v1' || !nonce || !tag || !body) throw new Error('Invalid sealed value');
  const cipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(nonce, 'base64'));
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(
    Buffer.concat([cipher.update(Buffer.from(body, 'base64')), cipher.final()]).toString('utf8'),
  );
}
