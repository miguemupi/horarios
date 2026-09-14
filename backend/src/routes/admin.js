import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { getConfig, mutateConfig } from '../services/config-store.js';
import { adminStatistics, createBusiness, createUser, deleteBusiness, deleteUser, listBusinesses, listRecords, listUsers, queueUnsyncedWorkDays, sheetSyncStatus, updateBusiness, updateUser } from '../services/postgres-store.js';
import { hashPassword } from '../services/password.js';
import { initializeSpreadsheet } from '../services/sheets.js';
import { processSheetOutbox } from '../services/sheet-sync-worker.js';
import { AppError, asyncRoute } from '../utils/errors.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.use((req, _res, next) => {
  if (req.session.user.demo && req.method !== 'GET') return next(new AppError(403, 'Los cambios están desactivados en el modo demostración.', 'DEMO_READ_ONLY'));
  next();
});

const email = z.string().email().transform((value) => value.toLowerCase());
const username = z.string().trim().toLowerCase().min(2).max(32).regex(/^[a-z0-9][a-z0-9._-]*$/, 'El usuario solo puede contener letras minúsculas, números, punto, guion y guion bajo.');
const password = z.string().min(12, 'La contraseña debe tener al menos 12 caracteres.').max(200);
const createUserSchema = z.object({ username, password, name: z.string().trim().min(2).max(120), role: z.enum(['employee', 'manager', 'admin']), active: z.boolean().default(true) });
const updateUserSchema = z.object({ name: z.string().trim().min(2).max(120).optional(), role: z.enum(['employee', 'manager', 'admin']).optional(), active: z.boolean().optional(), password: password.optional() });
const businessSchema = z.object({ name: z.string().trim().min(2).max(120), active: z.boolean().default(true) });
const settingsSchema = z.object({
  spreadsheetId: z.string().trim().min(10),
  timezone: z.string().trim().min(3),
  sheets: z.object({ detail: z.string().trim().min(1), dailySummary: z.string().trim().min(1), businessSummary: z.string().trim().min(1) }),
});
const reportFiltersSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, {
  message: 'La fecha inicial no puede ser posterior a la final.',
});

function safeUsers(users) {
  return users.map(({ passwordHash: _passwordHash, ...user }) => user);
}

async function persistFallbackUsers(users) {
  await mutateConfig((draft) => { draft.users = users.map(({ id: _id, ...user }) => user); });
}

async function persistFallbackBusinesses(businesses) {
  await mutateConfig((draft) => { draft.businesses = businesses; });
}

async function safeConfig(config) {
  return { ...config, users: safeUsers(await listUsers()), businesses: await listBusinesses() };
}

adminRouter.get('/config', asyncRoute(async (_req, res) => res.json(await safeConfig(getConfig()))));

adminRouter.get('/reports/statistics', asyncRoute(async (req, res) => {
  const filters = reportFiltersSchema.parse(req.query);
  res.json({ ...(await adminStatistics(filters)), sync: await sheetSyncStatus() });
}));

function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function durationCsv(totalHours) {
  const seconds = Math.round(Number(totalHours || 0) * 3600);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

adminRouter.get('/reports/export.csv', asyncRoute(async (req, res) => {
  const filters = reportFiltersSchema.parse(req.query);
  const rows = await listRecords({ user: req.session.user, ...filters });
  const table = [
    ['Fecha', 'Día semana', 'Empleado', 'Usuario', 'Negocio', 'Trabajo realizado', 'Hora inicio', 'Hora fin', 'Duración', 'Horas extra', 'Hora entrada día', 'Hora salida día'],
    ...rows.map((row) => [row.date, row.weekday, row.employeeName, row.employeeUsername, row.business, row.work,
      row.startTime, row.endTime, durationCsv(row.totalHours), row.overtime ? 'Sí' : 'No', row.dayStart, row.dayEnd]),
  ];
  const filename = `partes-${filters.dateFrom || 'inicio'}-${filters.dateTo || 'hoy'}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`\uFEFF${table.map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`);
}));

adminRouter.post('/sync-sheet', asyncRoute(async (_req, res) => {
  const queued = await queueUnsyncedWorkDays();
  const result = await processSheetOutbox(1000);
  const sync = await sheetSyncStatus();
  res.json({ queued, processed: result.processed, sync });
}));

adminRouter.put('/settings', asyncRoute(async (req, res) => {
  const settings = settingsSchema.parse(req.body);
  try { new Intl.DateTimeFormat('es-ES', { timeZone: settings.timezone }); } catch { throw new AppError(400, 'Zona horaria no válida.', 'INVALID_TIMEZONE'); }
  const config = await mutateConfig((draft) => { draft.settings = settings; });
  res.json(config.settings);
}));

adminRouter.post('/initialize-sheet', asyncRoute(async (_req, res) => res.json(await initializeSpreadsheet())));

adminRouter.post('/users', asyncRoute(async (req, res) => {
  const user = createUserSchema.parse(req.body);
  const passwordHash = await hashPassword(user.password);
  const users = await createUser(user, passwordHash, req.session.user.id);
  await persistFallbackUsers(users);
  res.status(201).json(safeUsers(users));
}));

adminRouter.put('/users/:email', asyncRoute(async (req, res) => {
  const targetEmail = email.parse(decodeURIComponent(req.params.email));
  const changes = updateUserSchema.parse(req.body);
  if (targetEmail === req.session.user.email && changes.active === false) throw new AppError(400, 'No puedes desactivar tu propia cuenta.', 'SELF_DEACTIVATION');
  if (targetEmail === req.session.user.email && changes.role && changes.role !== 'admin') throw new AppError(400, 'No puedes quitarte tu propio rol de administrador.', 'SELF_ROLE_CHANGE');
  const passwordHash = changes.password ? await hashPassword(changes.password) : null;
  const users = await updateUser(targetEmail, changes, passwordHash, req.session.user.id);
  await persistFallbackUsers(users);
  res.json(safeUsers(users));
}));

adminRouter.delete('/users/:email', asyncRoute(async (req, res) => {
  const targetEmail = email.parse(decodeURIComponent(req.params.email));
  if (targetEmail === req.session.user.email) throw new AppError(400, 'No puedes eliminar tu propia cuenta.', 'SELF_DELETION');
  await deleteUser(targetEmail, req.session.user.id);
  await persistFallbackUsers(await listUsers());
  res.status(204).end();
}));

adminRouter.post('/businesses', asyncRoute(async (req, res) => {
  const business = businessSchema.parse(req.body);
  const businesses = await createBusiness(business, req.session.user.id);
  await persistFallbackBusinesses(businesses);
  res.status(201).json(businesses);
}));

adminRouter.put('/businesses/:id', asyncRoute(async (req, res) => {
  const changes = businessSchema.partial().parse(req.body);
  const businesses = await updateBusiness(req.params.id, changes, req.session.user.id);
  await persistFallbackBusinesses(businesses);
  res.json(businesses);
}));

adminRouter.delete('/businesses/:id', asyncRoute(async (req, res) => {
  await deleteBusiness(req.params.id, req.session.user.id);
  await persistFallbackBusinesses(await listBusinesses());
  res.status(204).end();
}));
