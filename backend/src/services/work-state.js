import { transaction } from './database.js';
import { publishLiveEvent } from './live-events.js';
import { AppError } from '../utils/errors.js';
import { localDate, minutesBetween } from '../utils/time.js';

function identity(user) {
  return String(user.username || user.email || '').toLowerCase().replace(/@local\.invalid$/, '');
}

function serverTime(timezone, date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(date);
}

function mapTask(row) {
  return {
    recordId: row.id,
    clientEntryId: row.client_entry_id,
    business: row.business_name,
    work: row.description,
    material: row.material || '',
    startTime: row.start_time,
    endTime: row.end_time,
    totalHours: Number(row.duration_seconds) / 3600,
    overtime: Boolean(row.is_overtime),
  };
}

async function snapshot(client, dayId) {
  const dayResult = await client.query(
    `SELECT d.id, d.journey_key, d.work_date::text AS date, d.status, d.revision,
      to_char(d.day_start, 'HH24:MI:SS') AS day_start,
      to_char(d.day_end, 'HH24:MI:SS') AS day_end,
      to_char(d.active_task_start, 'HH24:MI:SS') AS active_task_start,
      d.active_task_planned, d.employee_signature, d.manager_signature, d.last_activity_at
     FROM work_days d WHERE d.id = $1`, [dayId],
  );
  if (!dayResult.rowCount) return null;
  const day = dayResult.rows[0];
  const tasks = await client.query(
    `SELECT id, client_entry_id, business_name, description, material, is_overtime,
      to_char(start_time, 'HH24:MI:SS') AS start_time,
      to_char(end_time, 'HH24:MI:SS') AS end_time, duration_seconds
     FROM work_tasks WHERE work_day_id = $1 ORDER BY position`, [dayId],
  );
  return {
    id: day.id,
    journeyKey: day.journey_key,
    date: day.date,
    status: day.status,
    revision: Number(day.revision),
    dayStart: day.day_start,
    dayEnd: day.day_end,
    activeTask: day.active_task_start ? { startTime: day.active_task_start, planned: day.active_task_planned } : null,
    employeeSignature: day.employee_signature || '',
    managerSignature: day.manager_signature || '',
    lastActivityAt: day.last_activity_at,
    tasks: tasks.rows.map(mapTask),
  };
}

async function actor(client, user) {
  const result = await client.query('SELECT id, username, display_name, role, active FROM app_users WHERE username = $1', [identity(user)]);
  const row = result.rows[0];
  if (!row?.active) throw new AppError(403, 'Usuario no autorizado.', 'FORBIDDEN');
  if (row.role === 'admin') throw new AppError(403, 'Administración no registra jornadas.', 'FORBIDDEN');
  return row;
}

async function ownedDay(client, userId, dayId) {
  const result = await client.query('SELECT * FROM work_days WHERE id = $1 AND user_id = $2 FOR UPDATE', [dayId, userId]);
  if (!result.rowCount) throw new AppError(404, 'Jornada no encontrada.', 'WORK_DAY_NOT_FOUND');
  return result.rows[0];
}

async function previousEvent(client, userId, idempotencyKey) {
  return (await client.query('SELECT work_day_id, payload FROM work_day_events WHERE user_id = $1 AND idempotency_key = $2', [userId, idempotencyKey])).rows[0];
}

const CUTOFF_TIME = '22:00:00';

// Cierra en el sitio una jornada que se quedó abierta de un día anterior, o que sigue abierta
// hoy tras el corte de las 22:00. Nunca inventa negocio/descripción de una tarea activa: si había
// una en curso, se descarta su puntero y se deja una incidencia para revisión humana.
export async function closeStaleWorkDay(client, userId, day) {
  if (day.active_task_start) {
    await client.query(
      `INSERT INTO attendance_incidents (user_id, work_day_id, incident_date, incident_type, details, dedupe_key)
       VALUES ($1,$2,$3::date,'task_left_open',$4::jsonb,$5)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [userId, day.id, day.work_date, JSON.stringify({ taskStart: day.active_task_start, reason: 'auto_close_22h' }), `task-left-open:${day.id}`],
    );
  }
  await client.query(
    `UPDATE work_days SET active_task_start = NULL, active_task_planned = false, status = 'submitted',
       day_end = $2::time, employee_signature = COALESCE(NULLIF(employee_signature, ''), '(Cierre automático 22:00)'),
       submitted_at = now(), revision = revision + 1, last_activity_at = now()
     WHERE id = $1`,
    [day.id, CUTOFF_TIME],
  );
  await client.query(
    `INSERT INTO work_day_events (work_day_id, user_id, event_type, idempotency_key, effective_date, effective_time, payload)
     VALUES ($1,$2,'day.finished', gen_random_uuid(), $3::date, $4::time, $5::jsonb)`,
    [day.id, userId, day.work_date, CUTOFF_TIME, JSON.stringify({ auto: true, reason: 'cutoff_22h' })],
  );
  await client.query(
    `INSERT INTO attendance_incidents (user_id, work_day_id, incident_date, incident_type, details, dedupe_key)
     VALUES ($1,$2,$3::date,'stale_open_day',$4::jsonb,$5)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [userId, day.id, day.work_date, JSON.stringify({ autoClosed: true, dayEnd: CUTOFF_TIME }), `stale-open-day:${day.id}`],
  );
}

async function closeIfStale(client, userId, timezone) {
  const openResult = await client.query(
    `SELECT id, work_date::text AS work_date, active_task_start
     FROM work_days WHERE user_id = $1 AND status = 'open' FOR UPDATE`, [userId],
  );
  if (!openResult.rowCount) return false;
  const day = openResult.rows[0];
  const today = localDate(timezone);
  const nowTime = serverTime(timezone);
  const isStale = day.work_date < today || (day.work_date === today && nowTime >= CUTOFF_TIME);
  if (!isStale) return false;
  await closeStaleWorkDay(client, userId, day);
  return true;
}

async function addEvent(client, { dayId, userId, eventType, idempotencyKey, deviceId, date, time, payload = {} }) {
  await client.query(
    `INSERT INTO work_day_events (work_day_id, user_id, event_type, idempotency_key, device_id, effective_date, effective_time, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [dayId, userId, eventType, idempotencyKey, deviceId || null, date, time, JSON.stringify(payload)],
  );
}

export async function currentWorkDay(sessionUser, timezone) {
  return transaction(async (client) => {
    const user = await actor(client, sessionUser);
    await closeIfStale(client, user.id, timezone);
    const result = await client.query(
      `SELECT id FROM work_days WHERE user_id = $1 AND status = 'open'
       ORDER BY work_date DESC, created_at DESC LIMIT 1`, [user.id],
    );
    return result.rowCount ? snapshot(client, result.rows[0].id) : null;
  });
}

export async function startWorkDay(sessionUser, input, timezone) {
  const result = await transaction(async (client) => {
    const user = await actor(client, sessionUser);
    await client.query('SELECT id FROM app_users WHERE id = $1 FOR UPDATE', [user.id]);
    const duplicate = await previousEvent(client, user.id, input.idempotencyKey);
    if (duplicate) return snapshot(client, duplicate.work_day_id);

    await closeIfStale(client, user.id, timezone);

    const date = input.date || localDate(timezone);
    const start = input.dayStart || serverTime(timezone);
    const taskStart = input.taskStart || start;
    const existingOpen = await client.query("SELECT id FROM work_days WHERE user_id = $1 AND status = 'open' FOR UPDATE", [user.id]);
    if (existingOpen.rowCount) return snapshot(client, existingOpen.rows[0].id);
    const sameDate = await client.query('SELECT id FROM work_days WHERE user_id = $1 AND work_date = $2 FOR UPDATE', [user.id, date]);
    let dayId;
    let eventType = 'day.started';
    if (sameDate.rowCount) {
      dayId = sameDate.rows[0].id;
      eventType = 'day.reopened';
      await client.query(
        `UPDATE work_days SET status = 'open', day_end = NULL, submitted_at = NULL,
          active_task_start = $2, active_task_planned = false, revision = revision + 1, last_activity_at = now()
         WHERE id = $1`, [dayId, taskStart],
      );
    } else {
      dayId = (await client.query(
        `INSERT INTO work_days (user_id, work_date, timezone, day_start, status, active_task_start, last_activity_at)
         VALUES ($1,$2,$3,$4,'open',$5,now()) RETURNING id`, [user.id, date, timezone, start, taskStart],
      )).rows[0].id;
    }
    await addEvent(client, { dayId, userId: user.id, eventType, idempotencyKey: input.idempotencyKey, deviceId: input.deviceId, date, time: taskStart });
    return snapshot(client, dayId);
  }, sessionUser.id);
  publishLiveEvent('work-day.changed', { workDayId: result.id });
  return result;
}

export async function startTask(sessionUser, dayId, input) {
  const result = await transaction(async (client) => {
    const user = await actor(client, sessionUser);
    const day = await ownedDay(client, user.id, dayId);
    const duplicate = await previousEvent(client, user.id, input.idempotencyKey);
    if (duplicate) return snapshot(client, duplicate.work_day_id);
    if (day.status !== 'open') throw new AppError(409, 'La jornada ya está cerrada.', 'WORK_DAY_CLOSED');
    if (day.active_task_start) throw new AppError(409, 'Ya existe una tarea activa.', 'TASK_ALREADY_ACTIVE');
    await client.query(
      `UPDATE work_days SET active_task_start = $2, active_task_planned = $3,
        revision = revision + 1, last_activity_at = now() WHERE id = $1`,
      [dayId, input.startTime, Boolean(input.planned)],
    );
    await addEvent(client, { dayId, userId: user.id, eventType: 'task.started', idempotencyKey: input.idempotencyKey,
      deviceId: input.deviceId, date: day.work_date, time: input.startTime, payload: { planned: Boolean(input.planned) } });
    return snapshot(client, dayId);
  }, sessionUser.id);
  publishLiveEvent('work-day.changed', { workDayId: result.id });
  return result;
}

export async function finishTask(sessionUser, dayId, input) {
  const result = await transaction(async (client) => {
    const user = await actor(client, sessionUser);
    const day = await ownedDay(client, user.id, dayId);
    const duplicate = await previousEvent(client, user.id, input.idempotencyKey);
    if (duplicate) return snapshot(client, duplicate.work_day_id);
    if (day.status !== 'open') throw new AppError(409, 'La jornada ya está cerrada.', 'WORK_DAY_CLOSED');
    const start = input.startTime || day.active_task_start;
    if (!start) throw new AppError(409, 'No existe una tarea activa.', 'NO_ACTIVE_TASK');
    const durationSeconds = Math.round(minutesBetween(start, input.endTime) * 60);
    const business = await client.query('SELECT id, name FROM businesses WHERE lower(name) = lower($1) AND active = true', [input.business]);
    if (!business.rowCount) throw new AppError(400, `El negocio "${input.business}" no está activo.`, 'INVALID_BUSINESS');
    const position = Number((await client.query('SELECT COALESCE(max(position), 0) + 1 AS position FROM work_tasks WHERE work_day_id = $1', [dayId])).rows[0].position);
    const task = await client.query(
      `INSERT INTO work_tasks (work_day_id, business_id, business_name, description, material, start_time, end_time, duration_seconds, position, client_entry_id, is_overtime)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (work_day_id, client_entry_id) WHERE client_entry_id IS NOT NULL DO UPDATE SET
         business_id = EXCLUDED.business_id, business_name = EXCLUDED.business_name, description = EXCLUDED.description,
         material = EXCLUDED.material, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
         duration_seconds = EXCLUDED.duration_seconds, is_overtime = EXCLUDED.is_overtime
       RETURNING id`,
      [dayId, business.rows[0].id, business.rows[0].name, input.work.trim(), input.material?.trim() || '', start,
        input.endTime, durationSeconds, position, input.clientEntryId, Boolean(input.overtime)],
    );
    await client.query(
      `UPDATE work_days SET active_task_start = NULL, active_task_planned = false,
        revision = revision + 1, last_activity_at = now() WHERE id = $1`, [dayId],
    );
    await addEvent(client, { dayId, userId: user.id, eventType: 'task.finished', idempotencyKey: input.idempotencyKey,
      deviceId: input.deviceId, date: day.work_date, time: input.endTime, payload: { taskId: task.rows[0].id } });
    return snapshot(client, dayId);
  }, sessionUser.id);
  publishLiveEvent('work-day.changed', { workDayId: result.id });
  return result;
}

export async function deleteOpenTask(sessionUser, dayId, taskId, input) {
  const result = await transaction(async (client) => {
    const user = await actor(client, sessionUser);
    const day = await ownedDay(client, user.id, dayId);
    const duplicate = await previousEvent(client, user.id, input.idempotencyKey);
    if (duplicate) return snapshot(client, duplicate.work_day_id);
    if (day.status !== 'open') throw new AppError(409, 'Solo se pueden retirar tareas antes de cerrar la jornada.', 'WORK_DAY_CLOSED');
    const removed = await client.query('DELETE FROM work_tasks WHERE id = $1 AND work_day_id = $2 RETURNING id', [taskId, dayId]);
    if (!removed.rowCount) throw new AppError(404, 'Tarea no encontrada.', 'TASK_NOT_FOUND');
    await client.query('UPDATE work_days SET revision = revision + 1, last_activity_at = now() WHERE id = $1', [dayId]);
    await addEvent(client, { dayId, userId: user.id, eventType: 'task.deleted', idempotencyKey: input.idempotencyKey,
      deviceId: input.deviceId, date: day.work_date, time: serverTime(day.timezone), payload: { taskId } });
    return snapshot(client, dayId);
  }, sessionUser.id);
  publishLiveEvent('work-day.changed', { workDayId: result.id });
  return result;
}

export async function finishWorkDay(sessionUser, dayId, input) {
  const result = await transaction(async (client) => {
    const user = await actor(client, sessionUser);
    const day = await ownedDay(client, user.id, dayId);
    const duplicate = await previousEvent(client, user.id, input.idempotencyKey);
    if (duplicate) return snapshot(client, duplicate.work_day_id);
    if (day.status !== 'open') return snapshot(client, dayId);
    if (day.active_task_start) throw new AppError(409, 'Finaliza la tarea activa antes de cerrar la jornada.', 'ACTIVE_TASK');
    const taskCount = Number((await client.query('SELECT count(*) AS count FROM work_tasks WHERE work_day_id = $1', [dayId])).rows[0].count);
    if (!taskCount) throw new AppError(400, 'La jornada necesita al menos una tarea.', 'EMPTY_WORK_DAY');
    minutesBetween(input.dayStart || day.day_start, input.dayEnd);
    await client.query(
      `UPDATE work_days SET day_start = $2, day_end = $3, status = 'submitted', employee_signature = $4,
        manager_signature = NULL, submitted_at = now(), revision = revision + 1, last_activity_at = now()
       WHERE id = $1`,
      [dayId, input.dayStart || day.day_start, input.dayEnd, input.employeeSignature],
    );
    await addEvent(client, { dayId, userId: user.id, eventType: 'day.finished', idempotencyKey: input.idempotencyKey,
      deviceId: input.deviceId, date: day.work_date, time: input.dayEnd, payload: { taskCount } });
    return snapshot(client, dayId);
  }, sessionUser.id);
  publishLiveEvent('work-day.changed', { workDayId: result.id });
  return result;
}
