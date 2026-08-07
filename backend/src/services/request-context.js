import { AsyncLocalStorage } from 'node:async_hooks';

const requestContext = new AsyncLocalStorage();

export function withRequestContext(req, _res, next) {
  requestContext.run({ ip: req.ip || '', userAgent: req.get('user-agent') || '' }, next);
}

export function getRequestContext() {
  return requestContext.getStore() || {};
}
