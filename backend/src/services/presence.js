import { getConfig } from './config-store.js';
import { isDatabaseUnavailable, query } from './database.js';
import { listUsers } from './postgres-store.js';
import { publishLiveEvent } from './live-events.js';

export const CONNECTION_STALE_MS = 60_000;

const presence = new Map();
const dismissedJourneys = new Map();

function memoryUpdate(user, payload, now) {
  if (!payload.working) {
    presence.delete(user.email);
    dismissedJourneys.delete(user.email);
    return;
  }
  const journeyKey = payload.journeyKey || `${payload.date}:${payload.dayStart}`;
  if (dismissedJourneys.get(user.email) === journeyKey) {
    presence.delete(user.email);
    return;
  }
  dismissedJourneys.delete(user.email);
  presence.set(user.email, {
    date: payload.date,
    dayStart: payload.dayStart,
    taskStart: payload.taskStart,
    activeTask: Boolean(payload.activeTask),
    planned: Boolean(payload.planned),
    journeyKey,
    lastSeen: now.toISOString(),
  });
}

export async function updatePresence(user, payload, now = new Date(), persist = true) {
  if (payload.deviceId && payload.sessionId) {
    if (!persist) return;
    const username = String(user.username || user.email || '').toLowerCase().replace(/@local\.invalid$/, '');
    try {
      if (payload.disconnected) {
        await query(
          `DELETE FROM device_presence p USING app_users u
           WHERE p.user_id = u.id AND u.username = $1 AND p.device_id = $2 AND p.session_id = $3`,
          [username, payload.deviceId, payload.sessionId],
        );
      } else {
        await query(
          `INSERT INTO device_presence (user_id, device_id, session_id, work_day_id, client_sequence, last_seen, user_agent)
           SELECT u.id, $2, $3, d.id, $5, $6, $7
           FROM app_users u
           LEFT JOIN work_days d ON d.id = $4 AND d.user_id = u.id AND d.status = 'open'
           WHERE u.username = $1
           ON CONFLICT (user_id, device_id, session_id) DO UPDATE SET
             work_day_id = EXCLUDED.work_day_id, client_sequence = EXCLUDED.client_sequence,
             last_seen = EXCLUDED.last_seen, user_agent = EXCLUDED.user_agent
           WHERE device_presence.client_sequence <= EXCLUDED.client_sequence`,
          [username, payload.deviceId, payload.sessionId, payload.workDayId || null,
            Number(payload.clientSequence || 0), now, payload.userAgent || null],
        );
      }
      publishLiveEvent('presence.changed', { username });
      return;
    } catch (error) {
      if (!isDatabaseUnavailable(error)) throw error;
      return;
    }
  }
  memoryUpdate(user, payload, now);
  if (!persist) return;
  const username = String(user.username || user.email || '').toLowerCase().replace(/@local\.invalid$/, '');
  try {
    if (!payload.working) {
      await query('DELETE FROM live_presence p USING app_users u WHERE p.user_id = u.id AND u.username = $1', [username]);
      return;
    }
    const journeyKey = payload.journeyKey || `${payload.date}:${payload.dayStart}`;
    await query(
      `INSERT INTO live_presence (user_id, journey_key, work_date, day_start, task_start, active_task, planned, last_seen)
       SELECT id, $2, $3, $4, $5, $6, $7, $8 FROM app_users WHERE username = $1
       ON CONFLICT (user_id) DO UPDATE SET journey_key = EXCLUDED.journey_key,
         work_date = EXCLUDED.work_date, day_start = EXCLUDED.day_start, task_start = EXCLUDED.task_start,
         active_task = EXCLUDED.active_task, planned = EXCLUDED.planned, dismissed = false, last_seen = EXCLUDED.last_seen
       WHERE live_presence.dismissed = false OR live_presence.journey_key <> EXCLUDED.journey_key`,
      [username, journeyKey, payload.date, payload.dayStart, payload.taskStart, Boolean(payload.activeTask), Boolean(payload.planned), now],
    );
  } catch (error) {
    if (!isDatabaseUnavailable(error)) throw error;
  }
}

export async function dismissPresence(email, persist = true) {
  const current = presence.get(email);
  if (current) dismissedJourneys.set(email, current.journeyKey);
  presence.delete(email);
  if (!persist) return Boolean(current);
  const username = String(email).toLowerCase().replace(/@local\.invalid$/, '');
  try {
    await query(
      `DELETE FROM device_presence p USING app_users u
       WHERE p.user_id = u.id AND u.username = $1`, [username],
    );
    const result = await query(
      `UPDATE live_presence p SET dismissed = true
       FROM app_users u WHERE p.user_id = u.id AND u.username = $1 AND p.dismissed = false`, [username],
    );
    publishLiveEvent('presence.changed', { username });
    return Boolean(current || result.rowCount);
  } catch (error) {
    if (!isDatabaseUnavailable(error)) throw error;
    return Boolean(current);
  }
}

function presenceState(user, current, now) {
  if (!current || current.dismissed) return { email: user.email, name: user.name, role: user.role, status: 'offline' };
  const secondsSinceLastSeen = Math.max(0, Math.floor((now.getTime() - new Date(current.lastSeen).getTime()) / 1000));
  return {
    email: user.email,
    name: user.name,
    role: user.role,
    status: current.planned ? 'planned' : 'working',
    date: current.date,
    dayStart: current.dayStart,
    taskStart: current.taskStart,
    activeTask: current.activeTask,
    lastSeen: current.lastSeen,
    secondsSinceLastSeen,
    connectionFresh: secondsSinceLastSeen * 1000 <= CONNECTION_STALE_MS,
  };
}

export function deriveServerPresence(user, server, now = new Date()) {
  if (!server?.work_day_id) return { email: user.email, name: user.name, role: user.role, status: 'offline', workState: 'offline', connectionState: 'offline' };
  const secondsSinceLastSeen = server.last_seen
    ? Math.max(0, Math.floor((now.getTime() - new Date(server.last_seen).getTime()) / 1000))
    : null;
  const connectionState = secondsSinceLastSeen === null ? 'offline'
    : secondsSinceLastSeen * 1000 <= CONNECTION_STALE_MS ? 'online' : 'stale';
  const status = server.planned ? 'planned' : server.active_task ? 'working' : 'between_tasks';
  return {
    email: user.email, name: user.name, role: user.role, status, workState: status,
    connectionState, connectionFresh: connectionState === 'online', deviceCount: server.device_count,
    workDayId: server.work_day_id, date: server.date, dayStart: server.day_start,
    taskStart: server.task_start, activeTask: server.active_task, lastSeen: server.last_seen,
    secondsSinceLastSeen,
  };
}

export async function teamPresence(now = new Date(), directory = null, persist = true) {
  let users = directory;
  if (!users) {
    try { users = await listUsers(); }
    catch (error) {
      if (!isDatabaseUnavailable(error)) throw error;
      users = getConfig().users;
    }
  }
  const activeUsers = users.filter((user) => user.active && user.role !== 'admin');
  let stored = null;
  let serverState = null;
  if (persist) {
    try {
      const stateResult = await query(
        `SELECT u.username, d.id AS work_day_id, d.work_date::text AS date,
          to_char(d.day_start, 'HH24:MI:SS') AS day_start,
          to_char(d.active_task_start, 'HH24:MI:SS') AS task_start,
          d.active_task_start IS NOT NULL AS active_task, d.active_task_planned AS planned,
          max(p.last_seen) AS last_seen, count(p.device_id)::int AS device_count
         FROM app_users u
         LEFT JOIN work_days d ON d.user_id = u.id AND d.status = 'open'
         LEFT JOIN device_presence p ON p.user_id = u.id
         GROUP BY u.id, d.id`,
      );
      serverState = new Map(stateResult.rows.map((row) => [row.username, row]));
      const result = await query(
        `SELECT u.username, p.journey_key, p.work_date::text AS date,
          to_char(p.day_start, 'HH24:MI:SS') AS day_start,
          to_char(p.task_start, 'HH24:MI:SS') AS task_start,
          p.active_task, p.planned, p.dismissed, p.last_seen
         FROM live_presence p JOIN app_users u ON u.id = p.user_id`,
      );
      stored = new Map(result.rows.map((row) => [row.username, {
        date: row.date, dayStart: row.day_start, taskStart: row.task_start,
        activeTask: row.active_task, planned: row.planned, dismissed: row.dismissed, lastSeen: row.last_seen,
      }]));
    } catch (error) {
      if (!isDatabaseUnavailable(error)) throw error;
    }
  }
  return activeUsers.map((user) => {
    const server = serverState?.get(user.username);
    if (server?.work_day_id) {
      return deriveServerPresence(user, server, now);
    }
    return presenceState(user, stored ? stored.get(user.username) : presence.get(user.email), now);
  }).sort((a, b) => {
    const priority = { working: 0, between_tasks: 1, planned: 2, offline: 3 };
    return priority[a.status] - priority[b.status] || a.name.localeCompare(b.name, 'es');
  });
}
