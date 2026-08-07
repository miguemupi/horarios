export class AppError extends Error {
  constructor(status, message, code = 'APP_ERROR', details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function errorHandler(error, _req, res, _next) {
  const status = error.status || (error.name === 'ZodError' ? 400 : 500);
  const payload = {
    error: {
      code: error.code || (error.name === 'ZodError' ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR'),
      message: status >= 500 ? 'No se ha podido completar la operación.' : error.message,
    },
  };
  if (error.name === 'ZodError') payload.error.details = error.issues;
  if (error.details && status < 500) payload.error.details = error.details;
  if (status >= 500) console.error({ name: error.name, message: error.message, code: error.code, status });
  res.status(status).json(payload);
}
