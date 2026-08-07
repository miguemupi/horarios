import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { env } from '../config.js';
import { getRequestContext } from './request-context.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (error) => console.error('Error inesperado en PostgreSQL:', error));

export async function query(text, values = []) {
  return pool.query(text, values);
}

export async function transaction(work, actorUserId = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (actorUserId) await client.query("SELECT set_config('app.current_user_id', $1, true)", [actorUserId]);
    const context = getRequestContext();
    if (context.ip) await client.query("SELECT set_config('app.request_ip', $1, true)", [context.ip]);
    if (context.userAgent) await client.query("SELECT set_config('app.request_user_agent', $1, true)", [context.userAgent.slice(0, 1000)]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function runMigrations() {
  if (!env.databaseUrl) throw new Error('DATABASE_URL es obligatorio para arrancar la aplicación.');
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const files = (await fs.readdir(env.migrationsDir))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();
  for (const file of files) {
    const version = path.basename(file, '.sql');
    const applied = await query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
    if (applied.rowCount) continue;
    const sql = await fs.readFile(path.join(env.migrationsDir, file), 'utf8');
    await query(sql);
    console.log(`Migración PostgreSQL aplicada: ${version}`);
  }
}

export async function databaseHealth() {
  const result = await query('SELECT now() AS now');
  return result.rows[0];
}

export function isDatabaseUnavailable(error) {
  const unavailableCodes = new Set([
    'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND',
    '08000', '08001', '08003', '08004', '08006', '08007', '08P01',
    '53300', '57P01', '57P02', '57P03',
  ]);
  let current = error;
  while (current) {
    if (unavailableCodes.has(String(current.code || ''))) return true;
    if (/connection terminated|connection timeout|connect econnrefused|the database system is (starting|shutting down)/i.test(String(current.message || ''))) return true;
    current = current.cause;
  }
  return false;
}
