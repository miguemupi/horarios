import test from 'node:test';
import assert from 'node:assert/strict';
import { nextIntervalDate } from '../src/utils/schedule.js';

test('programa la primera ejecución en la fecha de referencia', () => {
  const next = nextIntervalDate({ now: new Date(2026, 7, 7, 14, 0), intervalDays: 15, anchorDate: '2026-08-07', hour: 23, minute: 55 });
  assert.deepEqual([next.getFullYear(), next.getMonth(), next.getDate(), next.getHours(), next.getMinutes()], [2026, 7, 7, 23, 55]);
});

test('mantiene el ciclo de quince días después de reiniciar', () => {
  const next = nextIntervalDate({ now: new Date(2026, 7, 8, 9, 0), intervalDays: 15, anchorDate: '2026-08-07', hour: 23, minute: 55 });
  assert.deepEqual([next.getFullYear(), next.getMonth(), next.getDate(), next.getHours(), next.getMinutes()], [2026, 7, 22, 23, 55]);
});

test('rechaza una fecha de referencia inválida', () => {
  assert.throws(() => nextIntervalDate({ anchorDate: '2026-02-30' }), /fecha válida/);
});
