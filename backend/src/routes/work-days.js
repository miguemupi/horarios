import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { getConfig } from '../services/config-store.js';
import { currentWorkDay, deleteOpenTask, finishTask, finishWorkDay, startTask, startWorkDay } from '../services/work-state.js';
import { asyncRoute } from '../utils/errors.js';

export const workDaysRouter = Router();
workDaysRouter.use(requireAuth);

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/, 'Hora inválida');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida');
const command = {
  idempotencyKey: z.string().uuid(),
  deviceId: z.string().min(8).max(100),
};

workDaysRouter.get('/current', asyncRoute(async (req, res) => {
  res.json({ workDay: await currentWorkDay(req.session.user) });
}));

workDaysRouter.post('/start', asyncRoute(async (req, res) => {
  const input = z.object({ ...command, date: date.optional(), dayStart: time.optional(), taskStart: time.optional() }).parse(req.body);
  res.status(201).json({ workDay: await startWorkDay(req.session.user, input, getConfig().settings.timezone) });
}));

workDaysRouter.post('/:id/tasks/start', asyncRoute(async (req, res) => {
  const input = z.object({ ...command, startTime: time, planned: z.boolean().optional().default(false) }).parse(req.body);
  res.status(201).json({ workDay: await startTask(req.session.user, z.string().uuid().parse(req.params.id), input) });
}));

workDaysRouter.post('/:id/tasks/finish', asyncRoute(async (req, res) => {
  const input = z.object({
    ...command,
    clientEntryId: z.string().uuid(),
    business: z.string().trim().min(1).max(120),
    work: z.string().trim().min(2).max(2000),
    material: z.string().max(1000).optional().default(''),
    startTime: time.optional(),
    endTime: time,
  }).parse(req.body);
  res.status(201).json({ workDay: await finishTask(req.session.user, z.string().uuid().parse(req.params.id), input) });
}));

workDaysRouter.delete('/:id/tasks/:taskId', asyncRoute(async (req, res) => {
  const input = z.object(command).parse(req.body);
  res.json({ workDay: await deleteOpenTask(req.session.user, z.string().uuid().parse(req.params.id), z.string().uuid().parse(req.params.taskId), input) });
}));

workDaysRouter.post('/:id/finish', asyncRoute(async (req, res) => {
  const input = z.object({
    ...command,
    dayStart: time,
    dayEnd: time,
    employeeSignature: z.string().trim().min(2).max(200),
  }).parse(req.body);
  res.json({ workDay: await finishWorkDay(req.session.user, z.string().uuid().parse(req.params.id), input) });
}));
