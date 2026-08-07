import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/services/password.js';

test('almacena contraseñas con scrypt y sal', async () => {
  const first = await hashPassword('una-clave-segura');
  const second = await hashPassword('una-clave-segura');
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('una-clave-segura', first), true);
  assert.equal(await verifyPassword('clave-incorrecta', first), false);
});

test('rechaza hashes inválidos', async () => {
  assert.equal(await verifyPassword('cualquier-clave', 'texto-plano'), false);
});
