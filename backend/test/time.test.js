import test from 'node:test';
import assert from 'node:assert/strict';
import { minutesBetween } from '../src/utils/time.js';

test('calcula minutos en el mismo día', () => assert.equal(minutesBetween('09:15', '11:45'), 150));
test('admite turnos que cruzan medianoche', () => assert.equal(minutesBetween('23:30', '01:00'), 90));
test('calcula segundos sin perder precisión', () => assert.equal(minutesBetween('09:15:10', '09:16:25'), 1.25));
test('mantiene compatibilidad entre HH:mm y HH:mm:ss', () => assert.equal(minutesBetween('09:15', '09:16:30'), 1.5));
test('rechaza un intervalo de cero minutos', () => assert.throws(() => minutesBetween('10:00', '10:00')));
