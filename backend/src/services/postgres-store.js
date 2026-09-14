import crypto from 'node:crypto';
import { AppError } from '../utils/errors.js';
import { minutesBetween, weekday } from '../utils/time.js';
import { query, transaction } from './database.js';

function localEmail(username) {
  return `${username}@local.invalid`;
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: localEmail(row.username),
    username: row.username,
    passwordHash: row.password_hash,
    authProvider: 'local',
    name: row.display_name,
    role: row.role,
    active: row.active,
    mustChangePassword: Boolean(row.must_change_password),
  };
}

function mapBusiness(row) {
  return { id: row.id, name: row.name, active: row.active };
}

export async function bootstrapDirectory(config) {
  await transaction(async (client) => {
    const userCount = Number((await client.query('SELECT count(*) AS count FROM app_users')).rows[0].count);
    if (userCount === 0) {
      for (const user of config.users.filter((item) => item.username && item.passwordHash)) {
        await client.query(
          `INSERT INTO app_users (username, display_name, password_hash, role, active)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [user.username.toLowerCase(), user.name, user.passwordHash, user.role, user.active !== false],
        );
      }
    }
    const businessCount = Number((await client.query('SELECT count(*) AS count FROM businesses')).rows[0].count);
    if (businessCount === 0) {
      for (const business of config.businesses) {
        await client.query(
          `INSERT INTO businesses (id, name, active) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [business.id, business.name, business.active !== false],
        );
      }
    }
  });
}

export async function listUsers() {
  const result = await query('SELECT * FROM app_users ORDER BY display_name, username');
  return result.rows.map(mapUser);
}

export async function findLocalUser(username) {
  const result = await query('SELECT * FROM app_users WHERE username = lower($1) LIMIT 1', [username.trim()]);
  return mapUser(result.rows[0]);
}

export async function findUser(identity) {
  const username = String(identity || '').toLowerCase().replace(/@local\.invalid$/, '');
  return findLocalUser(username);
}

export async function createUser(user, passwordHash, actorId) {
  try {
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO app_users (username, display_name, password_hash, role, active, must_change_password)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [user.username, user.name, passwordHash, user.role, user.active],
      );
    }, actorId);
  } catch (error) {
    if (error.code === '23505') throw new AppError(409, 'Ese nombre de usuario ya existe.', 'USER_EXISTS');
    throw error;
  }
  return listUsers();
}

export async function updateUser(identity, changes, passwordHash, actorId) {
  const username = identity.toLowerCase().replace(/@local\.invalid$/, '');
  const fields = [];
  const values = [];
  const add = (column, value) => { values.push(value); fields.push(`${column} = $${values.length}`); };
  if (changes.name !== undefined) add('display_name', changes.name);
  if (changes.role !== undefined) add('role', changes.role);
  if (changes.active !== undefined) add('active', changes.active);
  if (passwordHash) { add('password_hash', passwordHash); add('must_change_password', false); add('password_changed_at', new Date()); }
  if (!fields.length) return listUsers();
  values.push(username);
  const result = await transaction((client) => client.query(
    `UPDATE app_users SET ${fields.join(', ')} WHERE username = $${values.length} RETURNING id`, values,
  ), actorId);
  if (!result.rowCount) throw new AppError(404, 'Usuario no encontrado.', 'USER_NOT_FOUND');
  return listUsers();
}

export async function deleteUser(identity, actorId) {
  const username = identity.toLowerCase().replace(/@local\.invalid$/, '');
  try {
    const result = await transaction((client) => client.query('DELETE FROM app_users WHERE username = $1', [username]), actorId);
    if (!result.rowCount) throw new AppError(404, 'Usuario no encontrado.', 'USER_NOT_FOUND');
  } catch (error) {
    if (error.code === '23503') throw new AppError(409, 'Ese usuario tiene partes registrados. Desactívalo en lugar de borrarlo.', 'USER_HAS_TIMESHEETS');
    throw error;
  }
}

export async function listBusinesses(activeOnly = false) {
  const result = await query(`SELECT * FROM businesses ${activeOnly ? 'WHERE active = true' : ''} ORDER BY name`);
  return result.rows.map(mapBusiness);
}

export async function createBusiness(business, actorId) {
  try {
    await transaction((client) => client.query(
      'INSERT INTO businesses (name, active) VALUES ($1, $2)', [business.name, business.active],
    ), actorId);
  } catch (error) {
    if (error.code === '23505') throw new AppError(409, 'Ese negocio ya existe.', 'BUSINESS_EXISTS');
    throw error;
  }
  return listBusinesses();
}

export async function updateBusiness(id, changes, actorId) {
  const fields = [];
  const values = [];
  if (changes.name !== undefined) { values.push(changes.name); fields.push(`name = $${values.length}`); }
  if (changes.active !== undefined) { values.push(changes.active); fields.push(`active = $${values.length}`); }
  if (!fields.length) return listBusinesses();
  values.push(id);
  try {
    const result = await transaction((client) => client.query(
      `UPDATE businesses SET ${fields.join(', ')} WHERE id = $${values.length}`, values,
    ), actorId);
    if (!result.rowCount) throw new AppError(404, 'Negocio no encontrado.', 'BUSINESS_NOT_FOUND');
  } catch (error) {
    if (error.code === '23505') throw new AppError(409, 'Ya existe otro negocio con ese nombre.', 'BUSINESS_EXISTS');
    throw error;
  }
  return listBusinesses();
}

export async function deleteBusiness(id, actorId) {
  await transaction(async (client) => {
    const result = await client.query('DELETE FROM businesses WHERE id = $1', [id]);
    if (!result.rowCount) throw new AppError(404, 'Negocio no encontrado.', 'BUSINESS_NOT_FOUND');
  }, actorId);
}

function mapRecord(row) {
  return {
    rowNumber: row.sheet_row_number,
    date: row.work_date,
    weekday: row.weekday,
    employeeName: row.employee_name,
    business: row.business_name,
    work: row.description,
    material: row.material || '',
    startTime: row.start_time,
    endTime: row.end_time,
    totalHours: Number(row.duration_seconds) / 3600,
    overtime: Boolean(row.is_overtime),
    dayStart: row.day_start,
    dayEnd: row.day_end,
    workDayId: row.work_day_id,
    recordId: row.id,
    sourceRecordId: row.sheet_record_id || row.created_at?.toISOString?.() || String(row.created_at),
    managerSignature: row.manager_signature || '',
    employeeSignature: row.employee_signature || row.employee_name,
    employeeUsername: row.employee_username,
    employeeEmail: localEmail(row.employee_username),
    employeeRole: row.employee_role,
    syncStatus: row.sheet_synced_at ? 'synced' : 'pending',
  };
}

const RECORD_SELECT = `
  SELECT t.*, d.user_id AS work_day_user_id, d.work_date::text, d.status AS work_day_status, to_char(d.day_start, 'HH24:MI:SS') AS day_start,
    to_char(d.day_end, 'HH24:MI:SS') AS day_end, d.manager_signature, d.employee_signature,
    u.display_name AS employee_name, u.username AS employee_username, u.role AS employee_role,
    to_char(t.start_time, 'HH24:MI:SS') AS start_time,
    to_char(t.end_time, 'HH24:MI:SS') AS end_time
  FROM work_tasks t
  JOIN work_days d ON d.id = t.work_day_id
  JOIN app_users u ON u.id = d.user_id`;

export async function listRecords({ user, dateFrom, dateTo, employee, business }) {
  const conditions = [];
  const values = [];
  const add = (sql, value) => { values.push(value); conditions.push(sql.replace('?', `$${values.length}`)); };
  if (!['admin', 'manager'].includes(user.role)) add('u.username = lower(?)', user.username || user.email);
  else if (employee) add('u.username = lower(?)', employee.replace(/@local\.invalid$/, ''));
  if (dateFrom) add('d.work_date >= ?::date', dateFrom);
  if (dateTo) add('d.work_date <= ?::date', dateTo);
  if (business) add('t.business_name = ?', business);
  const result = await query(`${RECORD_SELECT}
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY d.work_date DESC, t.start_time DESC, t.position DESC`, values);
  return result.rows.map((row) => mapRecord({ ...row, weekday: weekday(row.work_date, 'Europe/Madrid') }));
}

export async function saveTimesheet(payload, sessionUser, timezone) {
  const user = await findLocalUser(sessionUser.username || sessionUser.email);
  if (!user) throw new AppError(403, 'Usuario no encontrado en PostgreSQL.', 'USER_NOT_FOUND');
  const result = await transaction(async (client) => {
    const dayResult = await client.query(
      `INSERT INTO work_days (user_id, work_date, timezone, day_start, day_end, status, employee_signature, manager_signature, submitted_at)
       VALUES ($1, $2, $3, $4, $5, 'submitted', $6, $7, now())
       ON CONFLICT (user_id, work_date) DO UPDATE SET
         timezone = EXCLUDED.timezone, day_start = LEAST(work_days.day_start, EXCLUDED.day_start),
         day_end = EXCLUDED.day_end, status = 'corrected', employee_signature = EXCLUDED.employee_signature,
         manager_signature = EXCLUDED.manager_signature, submitted_at = now()
       RETURNING id`,
      [user.id, payload.date, timezone, payload.dayStart, payload.dayEnd, payload.employeeSignature, ''],
    );
    const dayId = dayResult.rows[0].id;
    const positionResult = await client.query('SELECT COALESCE(max(position), 0) AS position FROM work_tasks WHERE work_day_id = $1', [dayId]);
    let position = Number(positionResult.rows[0].position);
    const ids = [];
    for (const [entryIndex, entry] of payload.entries.entries()) {
      const businessResult = await client.query('SELECT id FROM businesses WHERE lower(name) = lower($1) AND active = true', [entry.business]);
      if (!businessResult.rowCount) throw new AppError(400, `El negocio "${entry.business}" no está activo.`, 'INVALID_BUSINESS');
      position += 1;
      const entryId = entry.clientEntryId || crypto.createHash('sha256').update(JSON.stringify([
        user.id, payload.date, entryIndex, entry.business, entry.work.trim(), entry.startTime, entry.endTime,
      ])).digest('hex');
      const inserted = await client.query(
        `INSERT INTO work_tasks (work_day_id, business_id, business_name, description, material, start_time, end_time, duration_seconds, position, client_entry_id, is_overtime)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (work_day_id, client_entry_id) WHERE client_entry_id IS NOT NULL DO UPDATE SET
           business_id = EXCLUDED.business_id, business_name = EXCLUDED.business_name,
           description = EXCLUDED.description, material = EXCLUDED.material,
           start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
           duration_seconds = EXCLUDED.duration_seconds, is_overtime = EXCLUDED.is_overtime, sheet_synced_at = NULL
         RETURNING id`,
        [dayId, businessResult.rows[0].id, entry.business, entry.work.trim(), entry.material?.trim() || '', entry.startTime,
          entry.endTime, Math.round(minutesBetween(entry.startTime, entry.endTime) * 60), position, entryId, Boolean(entry.overtime)],
      );
      ids.push(inserted.rows[0].id);
    }
    return { dayId, recordIds: ids };
  }, user.id);
  return { inserted: result.recordIds.length, ...result, syncStatus: 'pending' };
}

export async function updateRecord(recordId, changes, sessionUser) {
  const actor = await findLocalUser(sessionUser.username || sessionUser.email);
  if (!actor) throw new AppError(403, 'Usuario no encontrado.', 'USER_NOT_FOUND');
  await transaction(async (client) => {
    const currentResult = await client.query(`${RECORD_SELECT} WHERE t.id = $1`, [recordId]);
    if (!currentResult.rowCount) throw new AppError(404, 'No se encuentra esa tarea.', 'ROW_NOT_FOUND');
    const current = currentResult.rows[0];
    if (actor.role !== 'admin' && current.employee_username !== actor.username) {
      throw new AppError(403, 'Solo puedes editar tus propios partes.', 'FORBIDDEN');
    }
    if (current.work_day_status !== 'open' && !changes.correctionReason) {
      throw new AppError(400, 'Indica el motivo de la corrección.', 'CORRECTION_REASON_REQUIRED');
    }
    if (changes.business) {
      const business = await client.query('SELECT id FROM businesses WHERE lower(name) = lower($1) AND active = true', [changes.business]);
      if (!business.rowCount) throw new AppError(400, `El negocio "${changes.business}" no está activo.`, 'INVALID_BUSINESS');
      changes.businessId = business.rows[0].id;
    }
    const start = changes.startTime || current.start_time;
    const end = changes.endTime || current.end_time;
    await client.query(
      `UPDATE work_tasks SET business_id = COALESCE($2, business_id), business_name = COALESCE($3, business_name),
       description = COALESCE($4, description), material = COALESCE($5, material), start_time = $6, end_time = $7,
       duration_seconds = $8, is_overtime = COALESCE($9, is_overtime), sheet_synced_at = NULL WHERE id = $1`,
      [recordId, changes.businessId || null, changes.business || null, changes.work || null,
        changes.material ?? null, start, end, Math.round(minutesBetween(start, end) * 60), changes.overtime ?? null],
    );
    if (actor.role !== 'admin' && current.manager_signature) {
      await client.query(
        `UPDATE work_days SET manager_signature = NULL, status = 'corrected' WHERE id = $1`,
        [current.work_day_id],
      );
    }
    if (changes.date || changes.dayStart || changes.dayEnd || changes.managerSignature !== undefined || changes.employeeSignature) {
      await client.query(
        `UPDATE work_days SET work_date = COALESCE($2::date, work_date), day_start = COALESCE($3::time, day_start),
         day_end = COALESCE($4::time, day_end), manager_signature = COALESCE($5, manager_signature),
         employee_signature = COALESCE($6, employee_signature), status = 'corrected' WHERE id = $1`,
        [current.work_day_id, changes.date || null, changes.dayStart || null, changes.dayEnd || null,
          changes.managerSignature ?? null, changes.employeeSignature || null],
      );
    }
    if (current.work_day_status !== 'open') {
      await client.query(
        `INSERT INTO attendance_incidents (user_id, work_day_id, incident_date, incident_type, status, details, dedupe_key)
         VALUES ($1,$2,$3,'manual_correction','reviewed',$4::jsonb,$5)`,
        [current.work_day_user_id, current.work_day_id, current.work_date, JSON.stringify({ reason: changes.correctionReason, recordId }),
          `manual-correction:${recordId}:tx:${Date.now()}`],
      );
    }
  }, actor.id);
  const refreshed = await query(`${RECORD_SELECT} WHERE t.id = $1`, [recordId]);
  const row = refreshed.rows[0];
  return mapRecord({ ...row, weekday: weekday(row.work_date, 'Europe/Madrid') });
}

export async function setManagerSignature(workDayId, signed, sessionUser) {
  const actor = await findLocalUser(sessionUser.username || sessionUser.email);
  if (!actor) throw new AppError(403, 'Usuario no encontrado.', 'USER_NOT_FOUND');
  if (actor.role !== 'manager') {
    throw new AppError(403, 'Solo un jefe puede firmar los partes de los trabajadores.', 'FORBIDDEN');
  }
  const result = await transaction(async (client) => {
    const current = await client.query(
      `SELECT d.id, d.status, u.role AS employee_role
       FROM work_days d JOIN app_users u ON u.id = d.user_id
       WHERE d.id = $1 FOR UPDATE`,
      [workDayId],
    );
    if (!current.rowCount) throw new AppError(404, 'Parte no encontrado.', 'WORK_DAY_NOT_FOUND');
    const workDay = current.rows[0];
    if (workDay.employee_role !== 'employee') {
      throw new AppError(403, 'Solo se pueden firmar partes de trabajadores.', 'FORBIDDEN');
    }
    if (workDay.status === 'open') {
      throw new AppError(409, 'La jornada debe estar cerrada antes de que el jefe pueda firmarla.', 'WORK_DAY_OPEN');
    }
    const signature = signed ? actor.name : null;
    await client.query(
      `UPDATE work_days SET manager_signature = $2, revision = revision + 1, last_activity_at = now()
       WHERE id = $1`,
      [workDayId, signature],
    );
    await client.query('UPDATE work_tasks SET sheet_synced_at = NULL WHERE work_day_id = $1', [workDayId]);
    return { workDayId, signed, managerSignature: signature || '' };
  }, actor.id);
  return result;
}

export async function deleteRecord(recordId, sessionUser) {
  const actor = await findLocalUser(sessionUser.username || sessionUser.email);
  if (!actor) throw new AppError(403, 'Usuario no encontrado.', 'USER_NOT_FOUND');
  if (actor.role !== 'admin') {
    throw new AppError(403, 'Solo Administración puede borrar horas.', 'FORBIDDEN');
  }
  return transaction(async (client) => {
    const currentResult = await client.query(
      `SELECT t.id, t.work_day_id, t.sheet_row_number, t.sheet_record_id, t.description,
        d.work_date::text, u.display_name AS employee_name
       FROM work_tasks t
       JOIN work_days d ON d.id = t.work_day_id
       JOIN app_users u ON u.id = d.user_id
       WHERE t.id = $1 FOR UPDATE`,
      [recordId],
    );
    if (!currentResult.rowCount) throw new AppError(404, 'No se encuentra esa tarea.', 'ROW_NOT_FOUND');
    const current = currentResult.rows[0];

    await client.query(
      `INSERT INTO sheet_sync_outbox (aggregate_type, aggregate_id, event_type, payload, dedupe_key)
       VALUES ('work_task', $1, 'work_task.delete_from_sheet', $2::jsonb, $3)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [current.id, JSON.stringify({
        workDayId: current.work_day_id,
        sheetRowNumber: current.sheet_row_number,
        sheetRecordId: current.sheet_record_id,
      }), `delete-work-task:${current.id}`],
    );
    await client.query('DELETE FROM work_tasks WHERE id = $1', [current.id]);
    return {
      recordId: current.id,
      workDayId: current.work_day_id,
      employeeName: current.employee_name,
      date: current.work_date,
      work: current.description,
    };
  }, actor.id);
}

export async function workDaySnapshot(dayId) {
  const result = await query(`${RECORD_SELECT} WHERE d.id = $1 ORDER BY t.position`, [dayId]);
  return result.rows;
}

export async function markTasksSynced(mappings) {
  if (!mappings.length) return;
  await transaction(async (client) => {
    for (const item of mappings) {
      await client.query(
        'UPDATE work_tasks SET sheet_row_number = $2, sheet_record_id = $3, sheet_synced_at = now() WHERE id = $1',
        [item.id, item.rowNumber, item.sourceRecordId],
      );
    }
  });
}

export async function importSheetRecords(records, timezone) {
  if (!records.length) return { imported: 0, duplicates: 0, placeholderUsers: 0, invalidRows: 0 };
  const users = await listUsers();
  const byUsername = new Map(users.map((user) => [user.username, user]));
  const byName = new Map(users.map((user) => [user.name.trim().toLocaleLowerCase('es-ES'), user]));
  let imported = 0;
  let duplicates = 0;
  let placeholderUsers = 0;
  let invalidRows = 0;
  const normalizeIdentity = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  await transaction(async (client) => {
    for (const row of records) {
      let user = byUsername.get(String(row.employeeUsername || '').toLowerCase())
        || byName.get(String(row.employeeName || '').trim().toLocaleLowerCase('es-ES'));
      if (!row.date || !row.startTime || !row.endTime) { invalidRows += 1; continue; }
      if (!user) {
        const sheetIdentity = normalizeIdentity(row.employeeName);
        const fuzzy = users.filter((candidate) => {
          const username = normalizeIdentity(candidate.username);
          const displayName = normalizeIdentity(candidate.name);
          return sheetIdentity === username || sheetIdentity.startsWith(`${username} `)
            || sheetIdentity === displayName || sheetIdentity.startsWith(`${displayName} `);
        });
        if (fuzzy.length === 1) user = fuzzy[0];
      }
      if (!user) {
        const displayName = String(row.employeeName || 'Empleado histórico').trim();
        const slug = normalizeIdentity(displayName).replaceAll(' ', '.').slice(0, 24) || 'historico';
        let username = slug;
        let suffix = 1;
        while ((await client.query('SELECT 1 FROM app_users WHERE username = $1', [username])).rowCount) {
          suffix += 1;
          username = `${slug.slice(0, 28 - String(suffix).length)}.${suffix}`;
        }
        const created = await client.query(
          `INSERT INTO app_users (username, display_name, password_hash, role, active)
           VALUES ($1, $2, 'disabled:legacy-import', 'employee', false) RETURNING *`,
          [username, displayName],
        );
        user = mapUser(created.rows[0]);
        users.push(user);
        byUsername.set(user.username, user);
        byName.set(user.name.trim().toLocaleLowerCase('es-ES'), user);
        placeholderUsers += 1;
      }
      const sourceRecordId = `${String(row.sourceRecordId || 'sin-id')}::row:${row.rowNumber}`;
      const existingDay = await client.query('SELECT id FROM work_days WHERE user_id = $1 AND work_date = $2', [user.id, row.date]);
      const existingDayId = existingDay.rows[0]?.id || null;
      const duplicate = await client.query(
        `SELECT 1 FROM work_tasks
         WHERE sheet_record_id = $1 OR ($2::uuid IS NOT NULL AND work_day_id = $2 AND client_entry_id = $3)`,
        [sourceRecordId, existingDayId, `legacy:${row.rowNumber}`],
      );
      if (duplicate.rowCount) { duplicates += 1; continue; }
      const day = await client.query(
        `INSERT INTO work_days (user_id, work_date, timezone, day_start, day_end, status, employee_signature, manager_signature, submitted_at)
         VALUES ($1,$2,$3,$4,$5,'submitted',$6,$7,now())
         ON CONFLICT (user_id, work_date) DO UPDATE SET
           day_start = LEAST(work_days.day_start, EXCLUDED.day_start), day_end = EXCLUDED.day_end,
           employee_signature = EXCLUDED.employee_signature, manager_signature = EXCLUDED.manager_signature
         RETURNING id`,
        [user.id, row.date, timezone, row.dayStart || row.startTime, row.dayEnd || row.endTime,
          row.employeeSignature || user.name, row.managerSignature || ''],
      );
      const dayId = day.rows[0].id;
      const business = await client.query('SELECT id FROM businesses WHERE lower(name) = lower($1)', [row.business]);
      const position = Number((await client.query('SELECT COALESCE(max(position), 0) + 1 AS value FROM work_tasks WHERE work_day_id = $1', [dayId])).rows[0].value);
      const durationSeconds = Math.max(1, Math.round((Number(row.totalHours) || minutesBetween(row.startTime, row.endTime) / 60) * 3600));
      const createdAt = Number.isNaN(Date.parse(sourceRecordId)) ? new Date() : new Date(sourceRecordId);
      await client.query(
        `INSERT INTO work_tasks (work_day_id, business_id, business_name, description, material, start_time, end_time,
          duration_seconds, position, client_entry_id, sheet_row_number, sheet_record_id, sheet_synced_at, created_at, is_overtime)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),$13,$14)`,
        [dayId, business.rows[0]?.id || null, row.business || 'Sin negocio', row.work || 'Sin descripción', row.material || '',
          row.startTime, row.endTime, durationSeconds, position, `legacy:${row.rowNumber}`, row.rowNumber,
          sourceRecordId, createdAt, Boolean(row.overtime)],
      );
      imported += 1;
    }
  });
  return { imported, duplicates, placeholderUsers, invalidRows };
}

function reportFilters({ dateFrom, dateTo }) {
  const conditions = [];
  const values = [];
  if (dateFrom) { values.push(dateFrom); conditions.push(`d.work_date >= $${values.length}::date`); }
  if (dateTo) { values.push(dateTo); conditions.push(`d.work_date <= $${values.length}::date`); }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', values };
}

export async function adminStatistics(filters) {
  const { where, values } = reportFilters(filters);
  const [summary, employees, businesses, daily] = await Promise.all([
    query(`SELECT count(t.id)::int AS tasks, count(DISTINCT d.id)::int AS work_days,
      count(DISTINCT d.user_id)::int AS employees, COALESCE(sum(t.duration_seconds), 0)::bigint AS total_seconds,
      COALESCE(sum(t.duration_seconds) FILTER (WHERE t.is_overtime), 0)::bigint AS overtime_seconds
      FROM work_days d JOIN work_tasks t ON t.work_day_id = d.id ${where}`, values),
    query(`SELECT u.display_name AS name, u.username, count(t.id)::int AS tasks,
      count(DISTINCT d.id)::int AS work_days, COALESCE(sum(t.duration_seconds), 0)::bigint AS total_seconds,
      COALESCE(sum(t.duration_seconds) FILTER (WHERE t.is_overtime), 0)::bigint AS overtime_seconds
      FROM work_days d JOIN work_tasks t ON t.work_day_id = d.id JOIN app_users u ON u.id = d.user_id
      ${where} GROUP BY u.id ORDER BY total_seconds DESC, u.display_name`, values),
    query(`SELECT t.business_name AS name, count(t.id)::int AS tasks,
      count(DISTINCT d.id)::int AS work_days, COALESCE(sum(t.duration_seconds), 0)::bigint AS total_seconds
      FROM work_days d JOIN work_tasks t ON t.work_day_id = d.id ${where}
      GROUP BY t.business_name ORDER BY total_seconds DESC, t.business_name`, values),
    query(`SELECT d.work_date::text AS date, count(t.id)::int AS tasks,
      count(DISTINCT d.user_id)::int AS employees, COALESCE(sum(t.duration_seconds), 0)::bigint AS total_seconds
      FROM work_days d JOIN work_tasks t ON t.work_day_id = d.id ${where}
      GROUP BY d.work_date ORDER BY d.work_date`, values),
  ]);
  const totals = summary.rows[0];
  const totalSeconds = Number(totals.total_seconds);
  return {
    summary: {
      tasks: totals.tasks,
      workDays: totals.work_days,
      employees: totals.employees,
      totalSeconds,
      overtimeSeconds: Number(totals.overtime_seconds),
      averageSecondsPerDay: totals.work_days ? Math.round(totalSeconds / totals.work_days) : 0,
    },
    employees: employees.rows.map((row) => ({ ...row, totalSeconds: Number(row.total_seconds), overtimeSeconds: Number(row.overtime_seconds), total_seconds: undefined, overtime_seconds: undefined })),
    businesses: businesses.rows.map((row) => ({ ...row, totalSeconds: Number(row.total_seconds), total_seconds: undefined })),
    daily: daily.rows.map((row) => ({ ...row, totalSeconds: Number(row.total_seconds), total_seconds: undefined })),
  };
}

export async function queueUnsyncedWorkDays() {
  await query(
    `UPDATE sheet_sync_outbox o SET status = 'synced', synced_at = COALESCE(synced_at, now()),
       locked_at = NULL, locked_by = NULL, last_error = NULL
     WHERE aggregate_type = 'work_day' AND status IN ('pending', 'failed', 'processing')
       AND NOT EXISTS (SELECT 1 FROM work_tasks t WHERE t.work_day_id = o.aggregate_id AND t.sheet_synced_at IS NULL)`,
  );
  const result = await query(
    `INSERT INTO sheet_sync_outbox (aggregate_type, aggregate_id, event_type, payload, dedupe_key)
     SELECT 'work_day', d.id, 'work_day.manual_sync_requested', jsonb_build_object('work_day_id', d.id, 'manual', true),
       'manual-work-day:' || d.id || ':tx:' || txid_current()
     FROM work_days d
     WHERE EXISTS (SELECT 1 FROM work_tasks t WHERE t.work_day_id = d.id AND t.sheet_synced_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM sheet_sync_outbox o WHERE o.aggregate_id = d.id AND o.status IN ('pending', 'processing'))
     ON CONFLICT (dedupe_key) DO NOTHING`,
  );
  return result.rowCount;
}

export async function sheetSyncStatus() {
  const result = await query(
    `SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending,
      count(*) FILTER (WHERE status = 'processing')::int AS processing,
      count(*) FILTER (WHERE status = 'failed')::int AS failed,
      count(*) FILTER (WHERE status = 'synced')::int AS synced,
      max(synced_at) AS last_synced_at
     FROM sheet_sync_outbox`,
  );
  return {
    pending: result.rows[0].pending,
    processing: result.rows[0].processing,
    failed: result.rows[0].failed,
    synced: result.rows[0].synced,
    lastSyncedAt: result.rows[0].last_synced_at,
  };
}
