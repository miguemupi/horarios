import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth, requireSupervisor } from '../middleware/auth.js';
import { getConfig, publicSettings } from '../services/config-store.js';
import { deleteRecord, listBusinesses, listRecords, listUsers, saveTimesheet, setManagerSignature, updateRecord } from '../services/postgres-store.js';
import { appendTimesheet, listRecords as listSheetRecords, updateRecord as updateSheetRecord } from '../services/sheets.js';
import { isDatabaseUnavailable } from '../services/database.js';
import { localDate, minutesBetween } from '../utils/time.js';
import { AppError, asyncRoute } from '../utils/errors.js';

export const timesheetsRouter = Router();
timesheetsRouter.use(requireAuth);

const DEMO_ROWS = [
  { rowNumber: 2, date: '2026-08-05', weekday: 'miércoles', employeeName: 'Visitante de demostración', business: 'Mariatrifulca', work: 'Revisión de luminarias y sustitución de dos puntos de luz', material: '', startTime: '09:00:00', endTime: '10:30:00', totalHours: 1.5, dayStart: '08:45:00', dayEnd: '17:15:00', recordId: 'demo-1', managerSignature: 'Carlos Ruiz', employeeSignature: 'Visitante de demostración', employeeEmail: 'demo@factoria-serendipia.local' },
  { rowNumber: 3, date: '2026-08-04', weekday: 'martes', employeeName: 'Visitante de demostración', business: 'Lobby Club', work: 'Ajuste de cierre en puerta de almacén', material: '', startTime: '11:00:00', endTime: '12:15:00', totalHours: 1.25, dayStart: '08:45:00', dayEnd: '17:15:00', recordId: 'demo-2', managerSignature: 'Carlos Ruiz', employeeSignature: 'Visitante de demostración', employeeEmail: 'demo@factoria-serendipia.local' },
];

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/, 'Hora inválida');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida');
const entry = z.object({
  business: z.string().min(1).max(120),
  work: z.string().trim().min(2).max(2000),
  material: z.string().max(1000).optional().default(''),
  startTime: time,
  endTime: time,
  clientEntryId: z.string().uuid().optional(),
  overtime: z.boolean().optional().default(false),
});
const submission = z.object({
  date,
  dayStart: time,
  dayEnd: time,
  employeeSignature: z.string().trim().min(2).max(200),
  entries: z.array(entry).min(1).max(50),
});
const editable = z.object({
  date: date.optional(), business: z.string().min(1).max(120).optional(),
  work: z.string().trim().min(2).max(2000).optional(), material: z.string().max(1000).optional(),
  startTime: time.optional(), endTime: time.optional(), dayStart: time.optional(), dayEnd: time.optional(),
  employeeSignature: z.string().trim().min(2).max(200).optional(),
  correctionReason: z.string().trim().min(5).max(1000).optional(),
  overtime: z.boolean().optional(),
});

async function assertBusinesses(entries) {
  let businesses;
  try { businesses = await listBusinesses(true); }
  catch (error) {
    if (!isDatabaseUnavailable(error)) throw error;
    businesses = publicSettings().businesses;
  }
  const active = new Set(businesses.map((business) => business.name));
  const invalid = entries.find((item) => !active.has(item.business));
  if (invalid) throw new AppError(400, `El negocio "${invalid.business}" no está activo.`, 'INVALID_BUSINESS');
}

timesheetsRouter.get('/meta', asyncRoute(async (_req, res) => {
  try {
    return res.json({ settings: { timezone: getConfig().settings.timezone }, businesses: await listBusinesses(true) });
  } catch (error) {
    if (!isDatabaseUnavailable(error)) throw error;
    return res.json({ ...publicSettings(), storageFallback: 'google-sheets' });
  }
}));

timesheetsRouter.get('/employees', requireSupervisor, asyncRoute(async (_req, res) => {
  let directory;
  try { directory = await listUsers(); }
  catch (error) {
    if (!isDatabaseUnavailable(error)) throw error;
    directory = getConfig().users.filter((user) => user.authProvider === 'local');
  }
  const users = directory
    .filter((user) => user.active)
    .map(({ email, username, name, role }) => ({ email, username, name, role }));
  res.json({ users });
}));

timesheetsRouter.get('/', asyncRoute(async (req, res) => {
  if (req.session.user.demo) {
    let rows = DEMO_ROWS.filter((row) => row.employeeEmail === req.session.user.email);
    if (req.query.dateFrom) rows = rows.filter((row) => row.date >= req.query.dateFrom);
    if (req.query.dateTo) rows = rows.filter((row) => row.date <= req.query.dateTo);
    if (req.query.employee) rows = rows.filter((row) => row.employeeEmail === req.query.employee);
    if (req.query.business) rows = rows.filter((row) => row.business === req.query.business);
    return res.json({ rows });
  }
  const filters = { user: req.session.user, dateFrom: req.query.dateFrom, dateTo: req.query.dateTo, employee: req.query.employee, business: req.query.business };
  try {
    return res.json({ rows: await listRecords(filters), storage: 'postgres' });
  } catch (error) {
    if (!isDatabaseUnavailable(error)) throw error;
    return res.json({ rows: await listSheetRecords(filters), storage: 'google-sheets-fallback' });
  }
}));

timesheetsRouter.get('/today', asyncRoute(async (req, res) => {
  const dateToday = localDate(getConfig().settings.timezone);
  if (req.session.user.demo) return res.json({ date: dateToday, rows: [] });
  const filters = { user: req.session.user, dateFrom: dateToday, dateTo: dateToday };
  try { return res.json({ date: dateToday, rows: await listRecords(filters), storage: 'postgres' }); }
  catch (error) {
    if (!isDatabaseUnavailable(error)) throw error;
    return res.json({ date: dateToday, rows: await listSheetRecords(filters), storage: 'google-sheets-fallback' });
  }
}));

timesheetsRouter.post('/', asyncRoute(async (req, res) => {
  const payload = submission.parse(req.body);
  await assertBusinesses(payload.entries);
  payload.entries.forEach((item) => minutesBetween(item.startTime, item.endTime));
  minutesBetween(payload.dayStart, payload.dayEnd);
  if (req.session.user.demo) return res.status(201).json({ inserted: payload.entries.length, recordIds: payload.entries.map((_, index) => `demo-new-${index}`), demo: true });
  try {
    const result = await saveTimesheet(payload, req.session.user, getConfig().settings.timezone);
    return res.status(201).json({ ...result, storage: 'postgres' });
  } catch (error) {
    if (!isDatabaseUnavailable(error)) throw error;
    const result = await appendTimesheet(payload, req.session.user);
    return res.status(201).json({ ...result, storage: 'google-sheets-fallback', syncStatus: 'synced' });
  }
}));

timesheetsRouter.patch('/work-days/:workDayId/manager-signature', requireSupervisor, asyncRoute(async (req, res) => {
  const { signed } = z.object({ signed: z.boolean() }).parse(req.body);
  if (req.session.user.demo) throw new AppError(403, 'La demostración es de solo lectura.', 'DEMO_READ_ONLY');
  res.json(await setManagerSignature(z.string().uuid().parse(req.params.workDayId), signed, req.session.user));
}));

timesheetsRouter.patch('/:recordId', asyncRoute(async (req, res) => {
  const changes = editable.parse(req.body);
  if (changes.business) await assertBusinesses([{ business: changes.business }]);
  if (req.session.user.demo) {
    const existing = DEMO_ROWS.find((row) => row.recordId === req.params.recordId);
    if (!existing) throw new AppError(404, 'Fila de demostración no encontrada.', 'ROW_NOT_FOUND');
    return res.json({ row: { ...existing, ...changes } });
  }
  try {
    return res.json({ row: await updateRecord(req.params.recordId, changes, req.session.user), storage: 'postgres' });
  } catch (error) {
    if (!isDatabaseUnavailable(error)) throw error;
    return res.json({ row: await updateSheetRecord(req.params.recordId, changes, req.session.user), storage: 'google-sheets-fallback' });
  }
}));

timesheetsRouter.delete('/:recordId', requireAdmin, asyncRoute(async (req, res) => {
  if (req.session.user.demo) throw new AppError(403, 'La demostración es de solo lectura.', 'DEMO_READ_ONLY');
  await deleteRecord(req.params.recordId, req.session.user);
  res.status(204).end();
}));
