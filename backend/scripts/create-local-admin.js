import process from 'node:process';
import { initConfigStore, mutateConfig } from '../src/services/config-store.js';
import { hashPassword } from '../src/services/password.js';

const displayName = String(process.argv[2] || '').trim();
const username = String(process.argv[3] || displayName).trim().toLowerCase();

if (!displayName || !/^[\p{L}\p{N}._-]{2,64}$/u.test(username)) {
  throw new Error('Uso: node scripts/create-local-admin.js <nombre> [usuario]. La contraseña se recibe por stdin.');
}

let password = '';
for await (const chunk of process.stdin) password += chunk;
password = password.replace(/[\r\n]+$/, '');
if (password.length < 12) throw new Error('La contraseña debe tener al menos 12 caracteres.');

await initConfigStore();
const passwordHash = await hashPassword(password);
const email = `${username}@local.invalid`;
await mutateConfig((config) => {
  const existing = config.users.find((user) => user.email === email || (user.authProvider === 'local' && user.username === username));
  const account = { email, name: displayName, role: 'admin', active: true, authProvider: 'local', username, passwordHash };
  if (existing) Object.assign(existing, account);
  else config.users.push(account);
});

process.stdout.write(`Administrador local "${displayName}" creado o actualizado.\n`);
