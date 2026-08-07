import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [algorithm, salt, expectedHex] = String(stored || '').split(':');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await scrypt(password, salt, KEY_LENGTH);
  return crypto.timingSafeEqual(actual, expected);
}
