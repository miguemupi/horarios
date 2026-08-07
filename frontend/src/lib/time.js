export function currentDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function currentTime() {
  const now = new Date();
  return [now.getHours(), now.getMinutes(), now.getSeconds()].map((value) => String(value).padStart(2, '0')).join(':');
}

export function formatTime(value) {
  if (!value) return '';
  return /^\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
}

export function daysAgoDate(days) {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60_000);
  local.setDate(local.getDate() - days);
  return local.toISOString().slice(0, 10);
}

export function durationMinutes(start, end) {
  if (!start || !end) return 0;
  const [sh, sm, ss = 0] = start.split(':').map(Number);
  const [eh, em, es = 0] = end.split(':').map(Number);
  let totalSeconds = eh * 3600 + em * 60 + es - (sh * 3600 + sm * 60 + ss);
  if (totalSeconds < 0) totalSeconds += 86_400;
  return totalSeconds / 60;
}

function localDateTime(date, time) {
  const value = new Date(`${date}T${formatTime(time)}`);
  return Number.isNaN(value.getTime()) ? null : value;
}

export function elapsedMinutesSince(date, time, now = new Date()) {
  const startedAt = localDateTime(date, time);
  if (!startedAt) return 0;
  return Math.max(0, (now.getTime() - startedAt.getTime()) / 60_000);
}

export function isFutureDateTime(date, time, now = new Date()) {
  const value = localDateTime(date, time);
  return Boolean(value && value.getTime() > now.getTime());
}

export function formatDuration(minutes) {
  const totalSeconds = Math.max(0, Math.round(Number(minutes || 0) * 60));
  const hours = Math.floor(totalSeconds / 3600);
  const rest = totalSeconds % 3600;
  const mins = Math.floor(rest / 60);
  const seconds = rest % 60;
  return `${hours} h ${String(mins).padStart(2, '0')} min ${String(seconds).padStart(2, '0')} s`;
}
