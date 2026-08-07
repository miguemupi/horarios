import { query, transaction } from './database.js';
import { localDate } from '../utils/time.js';
import { AppError } from '../utils/errors.js';

export async function reconcileAttendance(timezone) {
  const today = localDate(timezone);
  const staleDays = await query(
    `INSERT INTO attendance_incidents (user_id, work_day_id, incident_date, incident_type, details, dedupe_key)
     SELECT d.user_id, d.id, d.work_date, 'stale_open_day',
       jsonb_build_object('dayStart', d.day_start, 'lastActivityAt', d.last_activity_at),
       'stale-open-day:' || d.id
     FROM work_days d
     WHERE d.status = 'open' AND d.work_date < $1::date
     ON CONFLICT (dedupe_key) DO NOTHING`, [today],
  );
  const longDays = await query(
    `INSERT INTO attendance_incidents (user_id, work_day_id, incident_date, incident_type, details, dedupe_key)
     SELECT d.user_id, d.id, d.work_date, 'open_too_long',
       jsonb_build_object('dayStart', d.day_start, 'lastActivityAt', d.last_activity_at),
       'open-too-long:' || d.id
     FROM work_days d
     WHERE d.status = 'open' AND d.created_at < now() - interval '16 hours'
     ON CONFLICT (dedupe_key) DO NOTHING`,
  );
  const openTasks = await query(
    `INSERT INTO attendance_incidents (user_id, work_day_id, incident_date, incident_type, details, dedupe_key)
     SELECT d.user_id, d.id, d.work_date, 'task_left_open',
       jsonb_build_object('taskStart', d.active_task_start, 'lastActivityAt', d.last_activity_at),
       'task-left-open:' || d.id
     FROM work_days d
     WHERE d.status = 'open' AND d.active_task_start IS NOT NULL
       AND d.last_activity_at < now() - interval '12 hours'
     ON CONFLICT (dedupe_key) DO NOTHING`,
  );
  const overlaps = await query(
    `INSERT INTO attendance_incidents (user_id, work_day_id, incident_date, incident_type, details, dedupe_key)
     SELECT DISTINCT d.user_id, d.id, d.work_date, 'overlapping_tasks', '{}'::jsonb,
       'overlapping-tasks:' || d.id
     FROM work_days d JOIN work_tasks a ON a.work_day_id = d.id JOIN work_tasks b ON b.work_day_id = d.id AND a.id < b.id
     WHERE a.start_time < a.end_time AND b.start_time < b.end_time
       AND a.start_time < b.end_time AND b.start_time < a.end_time
     ON CONFLICT (dedupe_key) DO NOTHING`,
  );
  return { created: staleDays.rowCount + longDays.rowCount + openTasks.rowCount + overlaps.rowCount };
}

export async function listIncidents(status = 'open') {
  const result = await query(
    `SELECT i.*, u.username, u.display_name
     FROM attendance_incidents i JOIN app_users u ON u.id = i.user_id
     WHERE ($1 = 'all' OR i.status = $1) ORDER BY i.incident_date DESC, i.created_at DESC`, [status],
  );
  return result.rows.map((row) => ({
    id: row.id, username: row.username, employeeName: row.display_name, date: row.incident_date,
    type: row.incident_type, status: row.status, details: row.details, createdAt: row.created_at,
    reviewedAt: row.reviewed_at, resolutionNote: row.resolution_note,
  }));
}

export async function resolveIncident(id, status, note, actorId) {
  return transaction(async (client) => {
    const result = await client.query(
      `UPDATE attendance_incidents SET status = $2, resolution_note = $3, reviewed_by = $4, reviewed_at = now()
       WHERE id = $1 RETURNING id`, [id, status, note || null, actorId],
    );
    if (!result.rowCount) throw new AppError(404, 'Incidencia no encontrada.', 'INCIDENT_NOT_FOUND');
    return { id, status };
  }, actorId);
}
