import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const testData = await fs.mkdtemp(path.join(os.tmpdir(), 'partes-roles-'));
process.env.DATA_DIR = testData;
process.env.CONFIG_FILE = path.join(testData, 'config.json');
process.env.SESSIONS_DIR = path.join(testData, 'sessions');
process.env.INITIAL_ADMIN_EMAIL = 'rrhh@example.com';
process.env.DEV_AUTH_BYPASS = 'true';
process.env.SESSION_SECRET = 'test-secret-with-at-least-thirty-two-characters';

const { getConfig, initConfigStore, mutateConfig } = await import('../src/services/config-store.js');
const { requireAdmin, requireSupervisor } = await import('../src/middleware/auth.js');
const { dismissPresence, teamPresence, updatePresence } = await import('../src/services/presence.js');

await initConfigStore();
await mutateConfig((config) => {
  config.users.push(
    { email: 'oscar@example.com', name: 'Óscar', role: 'manager', active: true },
    { email: 'worker@example.com', name: 'Trabajador', role: 'employee', active: true },
  );
});

after(() => fs.rm(testData, { recursive: true, force: true }));

function authorize(middleware, email, role) {
  return new Promise((resolve) => {
    middleware({ session: { user: { email, name: '', role } } }, {}, (error) => resolve(error || null));
  });
}

test('el trabajador no puede consultar el directorio del equipo', async () => {
  const error = await authorize(requireSupervisor, 'worker@example.com', 'employee');
  assert.equal(error.status, 403);
});

test('el jefe ve la presencia pero no accede a administración', async () => {
  assert.equal(await authorize(requireSupervisor, 'oscar@example.com', 'manager'), null);
  const adminError = await authorize(requireAdmin, 'oscar@example.com', 'manager');
  assert.equal(adminError.status, 403);
  await updatePresence(
    { email: 'worker@example.com' },
    { working: true, date: '2026-08-06', dayStart: '09:00:05', taskStart: '09:15:20', planned: false },
    new Date('2026-08-06T09:30:00Z'),
    false,
  );
  const members = await teamPresence(new Date('2026-08-06T09:30:30Z'), getConfig().users, false);
  assert.equal(members.find((member) => member.email === 'worker@example.com').status, 'working');
});

test('RR. HH. mantiene acceso a administración', async () => {
  assert.equal(await authorize(requireAdmin, 'rrhh@example.com', 'admin'), null);
});

test('el jefe puede descartar una jornada obsoleta sin que el mismo borrador la reactive', async () => {
  const payload = { working: true, date: '2026-08-06', dayStart: '09:00:00', taskStart: '09:00:00', activeTask: true, planned: false, journeyKey: 'journey-old' };
  await updatePresence({ email: 'worker@example.com' }, payload, new Date('2026-08-06T10:00:00Z'), false);
  assert.equal(await dismissPresence('worker@example.com', false), true);
  await updatePresence({ email: 'worker@example.com' }, payload, new Date('2026-08-06T10:00:05Z'), false);
  let members = await teamPresence(new Date('2026-08-06T10:00:10Z'), getConfig().users, false);
  assert.equal(members.find((member) => member.email === 'worker@example.com').status, 'offline');
  await updatePresence({ email: 'worker@example.com' }, { ...payload, journeyKey: 'journey-new' }, new Date('2026-08-06T10:00:15Z'), false);
  members = await teamPresence(new Date('2026-08-06T10:00:20Z'), getConfig().users, false);
  assert.equal(members.find((member) => member.email === 'worker@example.com').status, 'working');
});
