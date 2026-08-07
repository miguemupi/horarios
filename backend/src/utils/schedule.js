export function nextIntervalDate({ now = new Date(), intervalDays = 1, anchorDate = '', hour = 23, minute = 55 } = {}) {
  if (!Number.isInteger(intervalDays) || intervalDays < 1) throw new Error('El intervalo de sincronización debe ser un número entero positivo.');
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error('La hora de sincronización no es válida.');
  }

  let next;
  if (anchorDate) {
    const match = anchorDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) throw new Error('SHEET_SYNC_ANCHOR_DATE debe tener formato YYYY-MM-DD.');
    const [, year, month, day] = match.map(Number);
    next = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (next.getFullYear() !== year || next.getMonth() !== month - 1 || next.getDate() !== day) {
      throw new Error('SHEET_SYNC_ANCHOR_DATE no es una fecha válida.');
    }
    while (next <= now) next.setDate(next.getDate() + intervalDays);
    return next;
  }

  next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + intervalDays);
  return next;
}
