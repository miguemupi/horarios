import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireSupervisor } from '../middleware/auth.js';
import { listIncidents, resolveIncident } from '../services/incidents.js';
import { asyncRoute } from '../utils/errors.js';

export const incidentsRouter = Router();

incidentsRouter.get('/', requireSupervisor, asyncRoute(async (req, res) => {
  const status = z.enum(['open', 'reviewed', 'resolved', 'dismissed', 'all']).default('open').parse(req.query.status);
  res.json({ incidents: await listIncidents(status) });
}));

incidentsRouter.patch('/:id', requireAdmin, asyncRoute(async (req, res) => {
  const input = z.object({ status: z.enum(['reviewed', 'resolved', 'dismissed']), note: z.string().max(2000).optional().default('') }).parse(req.body);
  res.json(await resolveIncident(z.string().uuid().parse(req.params.id), input.status, input.note, req.session.user.id));
}));
