import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config.js';
import { AppError } from '../utils/errors.js';

const DEFAULT_BUSINESSES = [
  'Hotel Lobby Maquiavelo',
  'Mariatrifulca',
  'Ático Sevilla',
  'Lobby Club',
  'Dada',
  'Fun Club',
  'La Alicantina',
  'Casa Marciano',
  'La Casa de María',
];

const defaultConfig = () => ({
  version: 1,
  settings: {
    spreadsheetId: env.initialSpreadsheetId,
    timezone: env.timezone,
    sheets: {
      detail: 'Datos Diarios',
      dailySummary: 'Resumen diario',
      businessSummary: 'Resumen por negocio',
    },
  },
  users: env.initialAdminEmail
    ? [{ email: env.initialAdminEmail, name: 'Administrador', role: 'admin', active: true }]
    : [],
  allowedDomains: [],
  businesses: DEFAULT_BUSINESSES.map((name) => ({ id: crypto.randomUUID(), name, active: true })),
});

let state;
let writeQueue = Promise.resolve();

async function persist(next) {
  const dir = path.dirname(env.configFile);
  await fs.mkdir(dir, { recursive: true });
  const temporary = `${env.configFile}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, env.configFile);
}

export async function initConfigStore() {
  await fs.mkdir(env.dataDir, { recursive: true });
  try {
    state = JSON.parse(await fs.readFile(env.configFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = defaultConfig();
    await persist(state);
  }
  return state;
}

export function getConfig() {
  if (!state) throw new Error('Config store no inicializado.');
  return structuredClone(state);
}

export async function mutateConfig(mutator) {
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const next = structuredClone(state);
    await mutator(next);
    await persist(next);
    state = next;
  });
  await writeQueue;
  return getConfig();
}

export function publicSettings() {
  const config = getConfig();
  return {
    settings: { timezone: config.settings.timezone },
    businesses: config.businesses.filter((item) => item.active),
  };
}

export function findUser(email) {
  return getConfig().users.find((user) => user.email === email.toLowerCase());
}

export function findLocalUser(username) {
  const normalized = username.trim().toLowerCase();
  return getConfig().users.find((user) => user.authProvider === 'local' && user.username === normalized);
}

export function domainAllowed(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  return Boolean(domain && getConfig().allowedDomains.includes(domain));
}

export async function provisionDomainUser(profile) {
  if (!domainAllowed(profile.email)) return null;
  await mutateConfig((config) => {
    if (!config.users.some((user) => user.email === profile.email)) {
      config.users.push({ email: profile.email, name: profile.name, role: 'employee', active: true });
    }
  });
  return findUser(profile.email);
}

export function requireSpreadsheetSettings() {
  const settings = getConfig().settings;
  if (!settings.spreadsheetId) {
    throw new AppError(503, 'El administrador aún no ha configurado el Spreadsheet ID.', 'SHEET_NOT_CONFIGURED');
  }
  return settings;
}
