import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config.js';
import { findLocalUser as findConfigLocalUser, findUser as findConfigUser } from '../services/config-store.js';
import { findLocalUser, findUser } from '../services/postgres-store.js';
import { isDatabaseUnavailable, query, transaction } from '../services/database.js';
import { hashPassword, verifyPassword } from '../services/password.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError, asyncRoute } from '../utils/errors.js';

export const authRouter = Router();

const localLoginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });

authRouter.get('/me', (req, res) => res.json({ user: req.session?.user || null }));

authRouter.post('/local', localLoginLimiter, asyncRoute(async (req, res) => {
  const credentials = z.object({
    username: z.string().trim().min(2).max(64),
    password: z.string().min(4).max(200),
  }).parse(req.body);
  let authorized;
  try {
    authorized = await findLocalUser(credentials.username);
  } catch (error) {
    if (!isDatabaseUnavailable(error)) throw error;
    authorized = findConfigLocalUser(credentials.username);
  }
  const valid = authorized?.active && await verifyPassword(credentials.password, authorized.passwordHash);
  if (!valid) throw new AppError(401, 'Usuario o contraseña incorrectos.', 'INVALID_CREDENTIALS');
  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.user = { id: authorized.id, email: authorized.email, username: authorized.username, name: authorized.name, role: authorized.role, picture: '', local: true, mustChangePassword: authorized.mustChangePassword };
  res.json({ user: req.session.user });
}));

authRouter.post('/demo', (req, res, next) => {
  if (!env.demoMode) return next(new AppError(404, 'El modo demostración no está disponible.', 'NOT_FOUND'));
  req.session.user = {
    email: 'demo@factoria-serendipia.local',
    name: 'Visitante de demostración',
    role: 'employee',
    picture: '',
    demo: true,
  };
  res.json({ user: req.session.user });
});

authRouter.post('/logout', (req, res, next) => {
  req.session.destroy((error) => error ? next(error) : res.status(204).end());
});

authRouter.post('/change-password', requireAuth, asyncRoute(async (req, res) => {
  const input = z.object({
    currentPassword: z.string().min(4).max(200),
    newPassword: z.string().min(12, 'La nueva contraseña debe tener al menos 12 caracteres.').max(200),
  }).refine((value) => value.currentPassword !== value.newPassword, { path: ['newPassword'], message: 'La nueva contraseña debe ser diferente.' }).parse(req.body);
  const username = String(req.session.user.username || req.session.user.email).toLowerCase().replace(/@local\.invalid$/, '');
  const current = (await query('SELECT id, password_hash FROM app_users WHERE username = $1 AND active = true', [username])).rows[0];
  if (!current || !(await verifyPassword(input.currentPassword, current.password_hash))) {
    throw new AppError(401, 'La contraseña actual no es correcta.', 'INVALID_CURRENT_PASSWORD');
  }
  const passwordHash = await hashPassword(input.newPassword);
  await transaction((client) => client.query(
    'UPDATE app_users SET password_hash = $2, must_change_password = false, password_changed_at = now() WHERE id = $1',
    [current.id, passwordHash],
  ), current.id);
  req.session.user.mustChangePassword = false;
  res.json({ user: req.session.user });
}));

authRouter.post('/dev', asyncRoute(async (req, res) => {
  if (!env.devAuthBypass || env.nodeEnv === 'production') throw new AppError(404, 'No disponible.', 'NOT_FOUND');
  const email = String(req.body.email || env.initialAdminEmail).toLowerCase();
  let user;
  try { user = await findUser(email); }
  catch (error) {
    if (!isDatabaseUnavailable(error)) throw error;
    user = findConfigUser(email);
  }
  if (!user?.active) throw new AppError(403, 'Usuario de desarrollo no autorizado.', 'FORBIDDEN');
  req.session.user = { id: user.id, email: user.email, username: user.username, name: user.name, role: user.role, picture: '' };
  res.json({ user: req.session.user });
}));
