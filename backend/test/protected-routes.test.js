import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

test('los comandos de jornada no aceptan usuarios sin sesión', async () => {
  const response = await request(app).post('/api/work-days/start').send({});
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'UNAUTHENTICATED');
});

test('el estado del equipo y sus eventos en directo están protegidos', async () => {
  const presence = await request(app).get('/api/presence');
  const stream = await request(app).get('/api/presence/stream');
  assert.equal(presence.status, 401);
  assert.equal(stream.status, 401);
});

test('las incidencias requieren rol de supervisión', async () => {
  const response = await request(app).get('/api/incidents');
  assert.equal(response.status, 401);
});

test('la firma del encargado requiere una sesión con rol de supervisión', async () => {
  const response = await request(app)
    .patch('/api/timesheets/work-days/00000000-0000-4000-8000-000000000000/manager-signature')
    .send({ signed: true });
  assert.equal(response.status, 401);
});
