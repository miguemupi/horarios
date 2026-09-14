import fs from 'node:fs';
import { google } from 'googleapis';
import { env } from '../config.js';
import { getConfig, requireSpreadsheetSettings } from './config-store.js';
import { AppError } from '../utils/errors.js';
import { minutesBetween, weekday } from '../utils/time.js';

export const DETAIL_HEADERS = [
  'Fecha', 'Día semana', 'Empleado', 'Negocio', 'Trabajo realizado', 'Material',
  'Hora inicio', 'Hora fin', 'Total horas', 'Hora entrada día', 'Hora salida día',
  'Timestamp de registro', 'Firma encargado', 'Firma empleado', 'Usuario empleado',
];
const OVERTIME_HEADER = 'Horas extra';
export const DETAIL_HEADERS_OVERTIME = [...DETAIL_HEADERS, OVERTIME_HEADER];

const LEGACY_EMPLOYEE_HEADER = 'Email empleado';
const COMPACT_HEADERS = [
  'Fecha', 'Día semana', 'Empleado', 'Negocio', 'Trabajo realizado', 'Hora inicio',
  'Hora fin', 'Total horas', 'Hora entrada día', 'Hora salida día', 'Timestamp de registro',
];

const EXTENDED_LAYOUT = {
  type: 'extended', headers: DETAIL_HEADERS, endColumn: 'O',
  material: 5, startTime: 6, endTime: 7, totalHours: 8, dayStart: 9, dayEnd: 10,
  recordId: 11, managerSignature: 12, employeeSignature: 13, employeeUsername: 14, overtime: null,
};
// Igual que EXTENDED_LAYOUT pero con una columna P adicional para "¿Han sido en horas extra?".
// Es un layout aparte (y no una modificación de EXTENDED_LAYOUT) para no romper hojas ya en
// producción con la cabecera A:O documentada: siguen detectándose y funcionando igual que antes.
const EXTENDED_OVERTIME_LAYOUT = {
  type: 'extended-overtime', headers: DETAIL_HEADERS_OVERTIME, endColumn: 'P',
  material: 5, startTime: 6, endTime: 7, totalHours: 8, dayStart: 9, dayEnd: 10,
  recordId: 11, managerSignature: 12, employeeSignature: 13, employeeUsername: 14, overtime: 15,
};
const COMPACT_LAYOUT = {
  type: 'compact', headers: COMPACT_HEADERS, endColumn: 'K',
  material: null, startTime: 5, endTime: 6, totalHours: 7, dayStart: 8, dayEnd: 9,
  recordId: 10, managerSignature: null, employeeSignature: null, employeeUsername: null, overtime: null,
};

let api;
let writeLock = Promise.resolve();

function sheetRange(title, range) {
  return `'${title.replaceAll("'", "''")}'!${range}`;
}

function matchesHeaders(actual, expected) {
  return expected.every((header, index) => String(actual[index] || '').trim() === header);
}

function detectLayout(headers, allowEmpty = false) {
  if (!headers.length && allowEmpty) return EXTENDED_OVERTIME_LAYOUT;
  if (matchesHeaders(headers, COMPACT_HEADERS)) return COMPACT_LAYOUT;
  if (headers.length >= DETAIL_HEADERS_OVERTIME.length
    && DETAIL_HEADERS_OVERTIME.every((header, index) => String(headers[index] || '').trim() === header
      || (index === 14 && String(headers[index] || '').trim() === LEGACY_EMPLOYEE_HEADER))) return EXTENDED_OVERTIME_LAYOUT;
  if (headers.length >= DETAIL_HEADERS.length
    && DETAIL_HEADERS.every((header, index) => String(headers[index] || '').trim() === header
      || (index === 14 && String(headers[index] || '').trim() === LEGACY_EMPLOYEE_HEADER))) return EXTENDED_LAYOUT;
  throw new AppError(409, 'La cabecera de la hoja de datos no coincide con una estructura compatible.', 'SHEET_HEADER_MISMATCH');
}

async function readLayout(settings, allowEmpty = false) {
  const response = await withRetry(() => sheetsApi().spreadsheets.values.get({
    spreadsheetId: settings.spreadsheetId,
    range: sheetRange(settings.sheets.detail, 'A1:P1'),
  }));
  return detectLayout(response.data.values?.[0] || [], allowEmpty);
}

function credentials() {
  if (env.serviceAccountJson) {
    try {
      return JSON.parse(env.serviceAccountJson);
    } catch {
      throw new AppError(503, 'GOOGLE_SERVICE_ACCOUNT_JSON no contiene JSON válido.', 'GOOGLE_CREDENTIALS_INVALID');
    }
  }
  if (env.serviceAccountFile && fs.existsSync(env.serviceAccountFile)) return undefined;
  throw new AppError(503, 'Faltan las credenciales de la cuenta de servicio.', 'GOOGLE_CREDENTIALS_MISSING');
}

function sheetsApi() {
  if (!api) {
    const auth = new google.auth.GoogleAuth({
      ...(env.serviceAccountFile ? { keyFile: env.serviceAccountFile } : { credentials: credentials() }),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    api = google.sheets({ version: 'v4', auth });
  }
  return api;
}

async function withRetry(operation, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const status = error.code || error.response?.status;
      if (![429, 500, 502, 503, 504].includes(status) || attempt === attempts - 1) break;
      await new Promise((resolve) => setTimeout(resolve, 300 * (2 ** attempt) + Math.random() * 150));
    }
  }
  const status = lastError?.code || lastError?.response?.status;
  throw new AppError(status === 403 ? 503 : 502, 'Google Sheets no está disponible. El borrador sigue guardado en este dispositivo.', 'SHEETS_UNAVAILABLE');
}

export async function initializeSpreadsheet() {
  const settings = requireSpreadsheetSettings();
  const sheets = sheetsApi();
  const metadata = await withRetry(() => sheets.spreadsheets.get({ spreadsheetId: settings.spreadsheetId }));
  const normalizeTitle = (title) => title.trim().toLocaleLowerCase('es-ES');
  const existing = new Set(metadata.data.sheets.map((sheet) => normalizeTitle(sheet.properties.title)));
  const required = Object.values(settings.sheets);
  const requests = required.filter((title) => !existing.has(normalizeTitle(title))).map((title) => ({ addSheet: { properties: { title } } }));
  if (requests.length) {
    await withRetry(() => sheets.spreadsheets.batchUpdate({
      spreadsheetId: settings.spreadsheetId,
      requestBody: { requests },
    }));
  }

  const headerResponse = await withRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: settings.spreadsheetId,
    range: sheetRange(settings.sheets.detail, 'A1:P1'),
  }));
  const layout = detectLayout(headerResponse.data.values?.[0] || [], true);
  const totalColumn = layout.type === 'compact' ? 'H' : 'I';
  const dailyFormula = `=QUERY('${settings.sheets.detail}'!A:${layout.endColumn},"select A,C,sum(${totalColumn}) where A is not null group by A,C label sum(${totalColumn}) 'Total horas'",1)`;
  const businessFormula = `=QUERY('${settings.sheets.detail}'!A:${layout.endColumn},"select A,D,sum(${totalColumn}) where A is not null group by A,D label sum(${totalColumn}) 'Total horas'",1)`;
  await withRetry(() => sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: settings.spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: sheetRange(settings.sheets.detail, `A1:${layout.endColumn}1`), values: [layout.headers] },
        { range: sheetRange(settings.sheets.dailySummary, 'A1'), values: [[dailyFormula]] },
        { range: sheetRange(settings.sheets.businessSummary, 'A1'), values: [[businessFormula]] },
      ],
    },
  }));
  return { createdSheets: requests.length, sheets: required, layout: layout.type };
}

function normalizeDate(value) {
  const match = String(value || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : String(value || '');
}

function normalizeTime(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}:${match[3] || '00'}` : String(value || '');
}

function normalizeHours(value) {
  const text = String(value || '').trim();
  const duration = text.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (duration) return Number(duration[1]) + Number(duration[2]) / 60 + Number(duration[3] || 0) / 3600;
  const number = Number(text.replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
}

function inferredUsername(employeeName, usernamesByName) {
  const normalizedName = String(employeeName || '').trim().toLocaleLowerCase('es-ES');
  return usernamesByName.get(normalizedName) || '';
}

function rowToRecord(row, rowNumber, layout, usernamesByName = new Map()) {
  const sourceRecordId = row[layout.recordId] || '';
  const storedUsername = layout.employeeUsername === null ? '' : row[layout.employeeUsername];
  const employeeUsername = String(storedUsername || inferredUsername(row[2], usernamesByName)).toLowerCase();
  return {
    rowNumber,
    date: normalizeDate(row[0]), weekday: row[1] || '', employeeName: row[2] || '', business: row[3] || '',
    work: row[4] || '', material: layout.material === null ? '' : row[layout.material] || '',
    startTime: normalizeTime(row[layout.startTime]), endTime: normalizeTime(row[layout.endTime]),
    totalHours: normalizeHours(row[layout.totalHours]), dayStart: normalizeTime(row[layout.dayStart]), dayEnd: normalizeTime(row[layout.dayEnd]),
    overtime: layout.overtime === null ? false : row[layout.overtime] === 'Sí',
    recordId: layout.type === 'compact' ? `${sourceRecordId || 'sin-id'}::row:${rowNumber}` : sourceRecordId,
    sourceRecordId,
    managerSignature: layout.managerSignature === null ? '' : row[layout.managerSignature] || '',
    employeeSignature: layout.employeeSignature === null ? row[2] || '' : row[layout.employeeSignature] || '',
    employeeUsername,
    employeeEmail: employeeUsername,
  };
}

async function readAll() {
  const settings = requireSpreadsheetSettings();
  const layout = await readLayout(settings);
  const usernamesByName = new Map(getConfig().users
    .filter((user) => user.username)
    .map((user) => [user.name.trim().toLocaleLowerCase('es-ES'), user.username]));
  const response = await withRetry(() => sheetsApi().spreadsheets.values.get({
    spreadsheetId: settings.spreadsheetId,
    range: sheetRange(settings.sheets.detail, `A2:${layout.endColumn}`),
  }));
  return { layout, rows: (response.data.values || []).map((row, index) => rowToRecord(row, index + 2, layout, usernamesByName)) };
}

export async function readAllSheetRecords() {
  const { rows } = await readAll();
  return rows;
}

export async function listRecords({ user, dateFrom, dateTo, employee, business }) {
  let { rows } = await readAll();
  const canViewTeam = ['admin', 'manager'].includes(user.role);
  const identity = (user.username || user.email).toLowerCase();
  if (!canViewTeam) rows = rows.filter((row) => row.employeeUsername === identity || row.employeeUsername === user.email);
  if (dateFrom) rows = rows.filter((row) => row.date >= dateFrom);
  if (dateTo) rows = rows.filter((row) => row.date <= dateTo);
  if (employee && canViewTeam) rows = rows.filter((row) => row.employeeUsername === employee.toLowerCase());
  if (business) rows = rows.filter((row) => row.business === business);
  return rows.sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`));
}

function recordRow(payload, work, user, timestamp, layout) {
  const config = getConfig();
  const common = {
    date: payload.date,
    weekday: weekday(payload.date, config.settings.timezone),
    employeeName: user.name,
    business: work.business,
    work: work.work.trim(),
    material: work.material?.trim() || '',
    startTime: work.startTime,
    endTime: work.endTime,
    totalHours: work.totalHours ?? Number((minutesBetween(work.startTime, work.endTime) / 60).toFixed(6)),
    dayStart: payload.dayStart,
    dayEnd: payload.dayEnd,
    timestamp,
    managerSignature: payload.managerSignature?.trim() || '',
    employeeSignature: payload.employeeSignature.trim(),
    employeeUsername: user.username || user.email,
    overtime: work.overtime ? 'Sí' : 'No',
  };
  if (layout.type === 'compact') return [
    common.date, common.weekday, common.employeeName, common.business, common.work,
    common.startTime, common.endTime, common.totalHours, common.dayStart, common.dayEnd,
    common.timestamp,
  ];
  const row = [
    common.date, common.weekday, common.employeeName, common.business, common.work, common.material,
    common.startTime, common.endTime, common.totalHours, common.dayStart, common.dayEnd,
    common.timestamp, common.managerSignature, common.employeeSignature, common.employeeUsername,
  ];
  return layout.overtime === null ? row : [...row, common.overtime];
}

function updatedRow(merged, layout, totalHours) {
  const timestamp = merged.sourceRecordId;
  if (layout.type === 'compact') return [
    merged.date, weekday(merged.date, getConfig().settings.timezone), merged.employeeName, merged.business,
    merged.work.trim(), merged.startTime, merged.endTime, totalHours, merged.dayStart, merged.dayEnd,
    timestamp,
  ];
  const row = [
    merged.date, weekday(merged.date, getConfig().settings.timezone), merged.employeeName, merged.business,
    merged.work.trim(), merged.material?.trim() || '', merged.startTime, merged.endTime, totalHours,
    merged.dayStart, merged.dayEnd, timestamp, merged.managerSignature || '', merged.employeeSignature,
    merged.employeeUsername,
  ];
  return layout.overtime === null ? row : [...row, merged.overtime ? 'Sí' : 'No'];
}

export async function appendTimesheet(payload, user) {
  const execute = async () => {
    const settings = requireSpreadsheetSettings();
    const sheets = sheetsApi();
    const layout = await readLayout(settings);
    const column = await withRetry(() => sheets.spreadsheets.values.get({
      spreadsheetId: settings.spreadsheetId,
      range: sheetRange(settings.sheets.detail, 'A:A'),
    }));
    const startRow = Math.max(2, (column.data.values?.length || 0) + 1);
    const base = Date.now();
    const rows = payload.entries.map((work, index) => recordRow(payload, work, user, new Date(base + index).toISOString(), layout));
    await withRetry(() => sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: settings.spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [{
          range: sheetRange(settings.sheets.detail, `A${startRow}:${layout.endColumn}${startRow + rows.length - 1}`),
          values: rows,
        }],
      },
    }));
    return { inserted: rows.length, recordIds: rows.map((row) => row[layout.recordId]) };
  };
  const pending = writeLock.then(execute, execute);
  writeLock = pending.catch(() => {});
  return pending;
}

export async function updateRecord(recordId, changes, user) {
  const settings = requireSpreadsheetSettings();
  const { layout, rows } = await readAll();
  const existing = rows.find((row) => row.recordId === recordId);
  if (!existing) throw new AppError(404, 'No se encuentra esa fila en la Sheet.', 'ROW_NOT_FOUND');
  const identity = (user.username || user.email).toLowerCase();
  if (user.role !== 'admin' && existing.employeeUsername !== identity && existing.employeeUsername !== user.email) {
    throw new AppError(403, 'Solo puedes editar tus propios partes.', 'FORBIDDEN');
  }
  const merged = { ...existing, ...changes };
  const totalHours = Number((minutesBetween(merged.startTime, merged.endTime) / 60).toFixed(6));
  merged.employeeUsername = existing.employeeUsername;
  merged.sourceRecordId = existing.sourceRecordId;
  const values = [updatedRow(merged, layout, totalHours)];
  await withRetry(() => sheetsApi().spreadsheets.values.batchUpdate({
    spreadsheetId: settings.spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [{ range: sheetRange(settings.sheets.detail, `A${existing.rowNumber}:${layout.endColumn}${existing.rowNumber}`), values }],
    },
  }));
  return rowToRecord(values[0], existing.rowNumber, layout);
}

export async function clearSheetTask({ sheetRowNumber, sheetRecordId } = {}) {
  const settings = requireSpreadsheetSettings();
  const { layout, rows } = await readAll();
  const matchingRow = sheetRecordId
    ? rows.find((row) => String(row.sourceRecordId) === String(sheetRecordId))
    : null;
  const rowNumber = matchingRow?.rowNumber || Number(sheetRowNumber);
  if (!Number.isInteger(rowNumber) || rowNumber < 2) return { cleared: false };
  await withRetry(() => sheetsApi().spreadsheets.values.clear({
    spreadsheetId: settings.spreadsheetId,
    range: sheetRange(settings.sheets.detail, `A${rowNumber}:${layout.endColumn}${rowNumber}`),
  }));
  return { cleared: true, rowNumber };
}

export async function syncWorkDaySnapshot(snapshot) {
  if (!snapshot.length) return [];
  const settings = requireSpreadsheetSettings();
  const layout = await readLayout(settings);
  const { rows: sheetRows } = await readAll();
  const rowByRecordId = new Map(sheetRows
    .filter((row) => row.sourceRecordId)
    .map((row) => [String(row.sourceRecordId), row.rowNumber]));
  const column = await withRetry(() => sheetsApi().spreadsheets.values.get({
    spreadsheetId: settings.spreadsheetId,
    range: sheetRange(settings.sheets.detail, 'A:A'),
  }));
  let nextRow = Math.max(2, (column.data.values?.length || 0) + 1);
  const mappings = [];
  const data = snapshot.map((task) => {
    const sourceRecordId = task.sheet_record_id || new Date(task.created_at).toISOString();
    const sheetCellRecordId = String(sourceRecordId).replace(/::row:\d+$/, '');
    const rowNumber = rowByRecordId.get(String(sourceRecordId)) || task.sheet_row_number || nextRow++;
    const payload = {
      date: task.work_date,
      dayStart: task.day_start,
      dayEnd: task.day_end,
      managerSignature: task.manager_signature || '',
      employeeSignature: task.employee_signature || task.employee_name,
    };
    const work = {
      business: task.business_name,
      work: task.description,
      material: task.material || '',
      startTime: task.start_time,
      endTime: task.end_time,
      totalHours: Number(task.duration_seconds) / 3600,
      overtime: Boolean(task.is_overtime),
    };
    const user = { name: task.employee_name, username: task.employee_username };
    const values = recordRow(payload, work, user, sheetCellRecordId, layout);
    mappings.push({ id: task.id, rowNumber, sourceRecordId });
    return { range: sheetRange(settings.sheets.detail, `A${rowNumber}:${layout.endColumn}${rowNumber}`), values: [values] };
  });
  await withRetry(() => sheetsApi().spreadsheets.values.batchUpdate({
    spreadsheetId: settings.spreadsheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  }));
  return mappings;
}
