import { AppError } from '../utils/errors.js';
import { findUser } from '../services/config-store.js';

export function requireAuth(req, _res, next) {
  if (!req.session?.user) return next(new AppError(401, 'Debes iniciar sesión.', 'UNAUTHENTICATED'));
  if (req.session.user.demo) return next();
  const authorized = findUser(req.session.user.email);
  if (!authorized?.active) {
    return next(new AppError(403, 'Tu cuenta ya no está autorizada.', 'ACCOUNT_DISABLED'));
  }
  req.session.user.name = authorized.name;
  req.session.user.role = authorized.role;
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.session?.user) return next(new AppError(401, 'Debes iniciar sesión.', 'UNAUTHENTICATED'));
  if (req.session.user.demo && req.session.user.role === 'admin') return next();
  const authorized = findUser(req.session.user.email);
  if (!authorized?.active || authorized.role !== 'admin') return next(new AppError(403, 'Esta acción requiere rol de administrador.', 'FORBIDDEN'));
  req.session.user.name = authorized.name;
  req.session.user.role = authorized.role;
  next();
}

export function requireSupervisor(req, _res, next) {
  if (!req.session?.user) return next(new AppError(401, 'Debes iniciar sesión.', 'UNAUTHENTICATED'));
  if (req.session.user.demo && ['admin', 'manager'].includes(req.session.user.role)) return next();
  const authorized = findUser(req.session.user.email);
  if (!authorized?.active || !['admin', 'manager'].includes(authorized.role)) {
    return next(new AppError(403, 'Esta acción requiere rol de jefe o administrador.', 'FORBIDDEN'));
  }
  req.session.user.name = authorized.name;
  req.session.user.role = authorized.role;
  next();
}
