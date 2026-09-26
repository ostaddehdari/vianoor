import { randomInt } from 'node:crypto';
const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export function publicId() {
  let id: string;
  do {
    id = Array.from({ length: 13 }, () => alphabet[randomInt(alphabet.length)]).join('');
  } while (!/[A-Za-z]/.test(id) || !/[0-9]/.test(id));
  return id;
}
