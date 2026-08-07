const DEVICE_KEY = 'serendipia-device-id';
const SESSION_KEY = 'serendipia-session-id';

export function deviceId() {
  let value = localStorage.getItem(DEVICE_KEY);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, value); }
  return value;
}

export function deviceSessionId() {
  let value = sessionStorage.getItem(SESSION_KEY);
  if (!value) { value = crypto.randomUUID(); sessionStorage.setItem(SESSION_KEY, value); }
  return value;
}

export function commandIdentity() {
  return { idempotencyKey: crypto.randomUUID(), deviceId: deviceId() };
}

export function workDayStorageKey(email) {
  return `serendipia-work-day:${email}`;
}
