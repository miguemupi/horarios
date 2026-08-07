import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveServerPresence } from '../src/services/presence.js';

const user = { email: 'ana@local.invalid', name: 'Ana', role: 'employee' };
const base = {
  work_day_id: '8f59465a-30c7-45f8-ae78-9ed04ea75daf',
  date: '2026-08-07', day_start: '08:00:00', task_start: '09:00:00',
  active_task: true, planned: false, device_count: 2,
};

test('una jornada abierta sigue activa aunque todos los móviles estén sin conexión', () => {
  const state = deriveServerPresence(user, { ...base, last_seen: null }, new Date('2026-08-07T10:00:00Z'));
  assert.equal(state.workState, 'working');
  assert.equal(state.connectionState, 'offline');
});

test('la conexión obsoleta no transforma una jornada abierta en jornada cerrada', () => {
  const state = deriveServerPresence(user, { ...base, last_seen: '2026-08-07T09:55:00Z' }, new Date('2026-08-07T10:00:00Z'));
  assert.equal(state.workState, 'working');
  assert.equal(state.connectionState, 'stale');
  assert.equal(state.secondsSinceLastSeen, 300);
});

test('el servidor distingue una jornada entre tareas de una persona desconectada', () => {
  const state = deriveServerPresence(user, { ...base, active_task: false, task_start: null, last_seen: '2026-08-07T09:59:45Z' }, new Date('2026-08-07T10:00:00Z'));
  assert.equal(state.workState, 'between_tasks');
  assert.equal(state.connectionState, 'online');
  assert.equal(state.deviceCount, 2);
});
