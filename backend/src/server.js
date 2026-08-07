import { createApp } from './app.js';
import { env } from './config.js';
import { getConfig, initConfigStore, mutateConfig } from './services/config-store.js';
import { databaseHealth, isDatabaseUnavailable, pool, runMigrations } from './services/database.js';
import { bootstrapDirectory, importSheetRecords, listBusinesses, listUsers } from './services/postgres-store.js';
import { startSheetSyncWorker, stopSheetSyncWorker } from './services/sheet-sync-worker.js';
import { readAllSheetRecords } from './services/sheets.js';
import { reconcileAttendance } from './services/incidents.js';

await initConfigStore();
let databaseInitialized = false;
let databaseOutage = false;
let recoveryTimer;
let attendanceTimer;

async function initializeDatabase(reconcileFallback = false) {
  try {
    await runMigrations();
    await bootstrapDirectory(getConfig());
    const [users, businesses] = await Promise.all([listUsers(), listBusinesses()]);
    await mutateConfig((draft) => {
      draft.users = users.map(({ id: _id, ...user }) => user);
      draft.businesses = businesses;
    });
    if (reconcileFallback) {
      try {
        const rows = await readAllSheetRecords();
        const result = await importSheetRecords(rows, getConfig().settings.timezone || env.timezone);
        console.log(`Recuperación desde Sheets: ${result.imported} filas incorporadas a PostgreSQL.`);
      } catch (error) {
        console.error('PostgreSQL volvió, pero la conciliación con Sheets queda pendiente:', error.message);
      }
    }
    if (!databaseInitialized) startSheetSyncWorker();
    databaseInitialized = true;
    return true;
  } catch (error) {
    if (!isDatabaseUnavailable(error)) throw error;
    console.error('PostgreSQL no está disponible; la app arranca con Google Sheets como respaldo:', error.message);
    return false;
  }
}

databaseInitialized = await initializeDatabase();
databaseOutage = !databaseInitialized;
const server = createApp().listen(env.port, '0.0.0.0', () => {
  console.log(`Partes Serendipia escuchando en el puerto ${env.port}`);
});

recoveryTimer = setInterval(async () => {
  try {
    await databaseHealth();
    if (databaseOutage || !databaseInitialized) {
      databaseInitialized = await initializeDatabase(true);
      databaseOutage = !databaseInitialized;
    }
  } catch (error) {
    if (!isDatabaseUnavailable(error)) return console.error('Error comprobando PostgreSQL:', error);
    databaseOutage = true;
  }
}, 60_000);
recoveryTimer.unref?.();

await reconcileAttendance(getConfig().settings.timezone || env.timezone).catch((error) => console.error('No se pudo conciliar la asistencia:', error.message));
attendanceTimer = setInterval(() => {
  reconcileAttendance(getConfig().settings.timezone || env.timezone)
    .catch((error) => console.error('No se pudo conciliar la asistencia:', error.message));
}, 15 * 60_000);
attendanceTimer.unref?.();

async function shutdown() {
  stopSheetSyncWorker();
  if (recoveryTimer) clearInterval(recoveryTimer);
  if (attendanceTimer) clearInterval(attendanceTimer);
  server.close();
  await pool.end();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
