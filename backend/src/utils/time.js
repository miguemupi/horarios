import { AppError } from './errors.js';

export function minutesBetween(start, end) {
  const [startHour, startMinute, startSecond = 0] = start.split(':').map(Number);
  const [endHour, endMinute, endSecond = 0] = end.split(':').map(Number);
  let seconds = endHour * 3600 + endMinute * 60 + endSecond - (startHour * 3600 + startMinute * 60 + startSecond);
  if (seconds < 0) seconds += 24 * 3600;
  if (seconds === 0) throw new AppError(400, 'La hora de inicio y fin no pueden ser iguales.', 'INVALID_TIME_RANGE');
  return seconds / 60;
}

export function weekday(date, timezone) {
  const value = new Date(`${date}T12:00:00Z`);
  return new Intl.DateTimeFormat('es-ES', { weekday: 'long', timeZone: timezone }).format(value);
}

export function localDate(timezone, date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}
