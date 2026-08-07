import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireSupervisor } from '../middleware/auth.js';
import { CONNECTION_STALE_MS, dismissPresence, teamPresence, updatePresence } from '../services/presence.js';
import { asyncRoute } from '../utils/errors.js';
import { subscribeLiveEvents } from '../services/live-events.js';

export const presenceRouter = Router();

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/, 'Hora inválida');
const heartbeat = z.discriminatedUnion('working', [
  z.object({ working: z.literal(false) }),
  z.object({
    working: z.literal(true),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
    dayStart: time,
    taskStart: time,
    activeTask: z.boolean().default(false),
    planned: z.boolean().default(false),
    journeyKey: z.string().min(1).max(100).optional(),
  }),
]);

const deviceHeartbeat = z.object({
  deviceId: z.string().min(8).max(100),
  sessionId: z.string().min(8).max(100),
  workDayId: z.string().uuid().nullable().optional(),
  clientSequence: z.number().int().nonnegative(),
  disconnected: z.boolean().optional().default(false),
});

presenceRouter.put('/', requireAuth, asyncRoute(async (req, res) => {
  const input = req.body?.deviceId ? deviceHeartbeat.parse(req.body) : heartbeat.parse(req.body);
  await updatePresence(req.session.user, { ...input, userAgent: req.get('user-agent') || '' });
  res.status(204).end();
}));

presenceRouter.get('/stream', requireSupervisor, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(`event: ready\ndata: ${JSON.stringify({ generatedAt: new Date().toISOString() })}\n\n`);
  const unsubscribe = subscribeLiveEvents((event) => {
    res.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
  });
  const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 25_000);
  req.on('close', () => { clearInterval(keepAlive); unsubscribe(); });
});

presenceRouter.get('/', requireSupervisor, asyncRoute(async (_req, res) => {
  res.json({ members: await teamPresence(), connectionStaleAfterSeconds: CONNECTION_STALE_MS / 1000, generatedAt: new Date().toISOString() });
}));

presenceRouter.delete('/:email', requireSupervisor, asyncRoute(async (req, res) => {
  const email = z.string().email().parse(decodeURIComponent(req.params.email)).toLowerCase();
  res.json({ disconnected: await dismissPresence(email) });
}));
