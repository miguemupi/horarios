import { env } from '../src/config.js';
import { getConfig, initConfigStore } from '../src/services/config-store.js';
import { pool, runMigrations } from '../src/services/database.js';
import { bootstrapDirectory, importSheetRecords } from '../src/services/postgres-store.js';
import { readAllSheetRecords } from '../src/services/sheets.js';

try {
  await initConfigStore();
  await runMigrations();
  await bootstrapDirectory(getConfig());
  const rows = await readAllSheetRecords();
  const result = await importSheetRecords(rows, getConfig().settings.timezone || env.timezone);
  console.log(`Importación terminada: ${result.imported} importadas, ${result.duplicates} duplicadas, ${result.placeholderUsers} usuarios históricos creados y ${result.invalidRows} inválidas/vacías.`);
} finally {
  await pool.end();
}
