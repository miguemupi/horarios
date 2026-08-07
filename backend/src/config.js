import path from 'node:path';
import process from 'node:process';
import 'dotenv/config';

const root = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  frontendUrl: (process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, ''),
  sessionSecret: process.env.SESSION_SECRET || 'change-me-in-production',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL || `${process.env.APP_URL || 'http://localhost:3000'}/api/auth/google/callback`,
  serviceAccountFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE || '',
  serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
  initialAdminEmail: (process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase(),
  initialSpreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || '',
  timezone: process.env.APP_TIMEZONE || 'Europe/Madrid',
  dataDir: root,
  configFile: process.env.CONFIG_FILE || path.join(root, 'config.json'),
  sessionsDir: process.env.SESSIONS_DIR || path.join(root, 'sessions'),
  devAuthBypass: process.env.DEV_AUTH_BYPASS === 'true',
  demoMode: process.env.DEMO_MODE === 'true',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  databaseUrl: process.env.DATABASE_URL || '',
  migrationsDir: process.env.MIGRATIONS_DIR || path.resolve(process.cwd(), 'migrations'),
  sheetSyncHour: Number(process.env.SHEET_SYNC_HOUR || 23),
  sheetSyncMinute: Number(process.env.SHEET_SYNC_MINUTE || 55),
  sheetSyncIntervalDays: Number(process.env.SHEET_SYNC_INTERVAL_DAYS || 1),
  sheetSyncAnchorDate: (process.env.SHEET_SYNC_ANCHOR_DATE || '').trim(),
};

if (env.nodeEnv === 'production' && env.sessionSecret === 'change-me-in-production') {
  throw new Error('SESSION_SECRET es obligatorio en producción.');
}
