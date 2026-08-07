import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import fileStoreFactory from 'session-file-store';
import helmet from 'helmet';
import { env } from './config.js';
import { authRouter } from './routes/auth.js';
import { timesheetsRouter } from './routes/timesheets.js';
import { adminRouter } from './routes/admin.js';
import { presenceRouter } from './routes/presence.js';
import { workDaysRouter } from './routes/work-days.js';
import { incidentsRouter } from './routes/incidents.js';
import { AppError, asyncRoute, errorHandler } from './utils/errors.js';
import { databaseHealth, isDatabaseUnavailable } from './services/database.js';
import { withRequestContext } from './services/request-context.js';

const FileStore = fileStoreFactory(session);
fs.mkdirSync(env.sessionsDir, { recursive: true });

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: env.frontendUrl, credentials: true }));
  app.use(express.json({ limit: '300kb' }));
  app.use(withRequestContext);
  app.use(session({
    store: new FileStore({ path: env.sessionsDir, ttl: 60 * 60 * 24 * 7, retries: 0 }),
    secret: env.sessionSecret,
    name: 'serendipia.sid',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: env.cookieSecure, maxAge: 7 * 24 * 60 * 60 * 1000 },
  }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.get('/api/health', asyncRoute(async (_req, res) => {
    try {
      await databaseHealth();
      return res.json({ status: 'ok', database: 'ok', sheetsFallback: true });
    } catch (error) {
      if (!isDatabaseUnavailable(error)) throw error;
      return res.json({ status: 'degraded', database: 'unavailable', sheetsFallback: true });
    }
  }));
  app.use('/api/auth', authRouter);
  app.use('/api/timesheets', timesheetsRouter);
  app.use('/api/presence', presenceRouter);
  app.use('/api/work-days', workDaysRouter);
  app.use('/api/incidents', incidentsRouter);
  app.use('/api/admin', adminRouter);

  const staticDir = path.resolve(process.cwd(), 'public');
  if (fs.existsSync(staticDir)) {
    app.use(express.static(staticDir, {
      maxAge: env.nodeEnv === 'production' ? '1d' : 0,
      setHeaders: (res, filePath) => {
        if (path.basename(filePath) === 'index.html') res.setHeader('Cache-Control', 'no-store');
      },
    }));
    app.get('/{*path}', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.setHeader('Cache-Control', 'no-store');
      return res.sendFile(path.join(staticDir, 'index.html'));
    });
  }
  app.use((_req, _res, next) => next(new AppError(404, 'Ruta no encontrada.', 'NOT_FOUND')));
  app.use(errorHandler);
  return app;
}
