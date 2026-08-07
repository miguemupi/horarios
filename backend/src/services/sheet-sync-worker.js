import { env } from '../config.js';
import { query, transaction } from './database.js';
import { markTasksSynced, workDaySnapshot } from './postgres-store.js';
import { clearSheetTask, syncWorkDaySnapshot } from './sheets.js';
import { nextIntervalDate } from '../utils/schedule.js';

let timer;
let running = false;

async function claimEvent() {
  return transaction(async (client) => {
    await client.query(
      `UPDATE sheet_sync_outbox SET status = 'failed', locked_at = NULL, locked_by = NULL,
       last_error = 'Volcado interrumpido; se reintentará automáticamente', next_attempt_at = now()
       WHERE status = 'processing' AND locked_at < now() - interval '15 minutes'`,
    );
    const selected = await client.query(
      `SELECT id, aggregate_type, aggregate_id, event_type, payload, attempts FROM sheet_sync_outbox
       WHERE status IN ('pending', 'failed') AND next_attempt_at <= now()
       ORDER BY next_attempt_at, id FOR UPDATE SKIP LOCKED LIMIT 1`,
    );
    if (!selected.rowCount) return null;
    const event = selected.rows[0];
    await client.query(
      `UPDATE sheet_sync_outbox SET status = 'processing', locked_at = now(), locked_by = $2,
       attempts = attempts + 1, last_error = NULL WHERE id = $1`,
      [event.id, `worker-${process.pid}`],
    );
    return { ...event, attempts: Number(event.attempts) + 1 };
  });
}

async function completeEvent(event) {
  await query(
    `UPDATE sheet_sync_outbox SET status = 'synced', synced_at = now(), locked_at = NULL,
     locked_by = NULL, last_error = NULL
     WHERE id = $1 OR (aggregate_id = $2 AND status IN ('pending', 'failed'))`, [event.id, event.aggregate_id],
  );
}

async function failEvent(event, error) {
  const delaySeconds = Math.min(3600, 15 * (2 ** Math.min(event.attempts - 1, 8)));
  if (event.aggregate_type === 'work_day') {
    const redundant = await query(
      `UPDATE sheet_sync_outbox o SET status = 'synced', synced_at = COALESCE(synced_at, now()),
       locked_at = NULL, locked_by = NULL, last_error = NULL
       WHERE id = $1 AND NOT EXISTS (
         SELECT 1 FROM work_tasks t WHERE t.work_day_id = o.aggregate_id AND t.sheet_synced_at IS NULL
       )`, [event.id],
    );
    if (redundant.rowCount) return;
  }
  await query(
    `UPDATE sheet_sync_outbox SET status = 'failed', locked_at = NULL, locked_by = NULL,
     last_error = $2, next_attempt_at = now() + ($3 * interval '1 second') WHERE id = $1`,
    [event.id, String(error.message || error).slice(0, 2000), delaySeconds],
  );
  console.error(`Fallo al sincronizar ${event.aggregate_type} ${event.aggregate_id} con Sheets; reintento en ${delaySeconds}s:`, error.message);
}

export async function processSheetOutbox(limit = 10) {
  if (running) return { processed: 0 };
  running = true;
  let processed = 0;
  try {
    while (processed < limit) {
      const event = await claimEvent();
      if (!event) break;
      try {
        if (event.event_type === 'work_task.delete_from_sheet') {
          await clearSheetTask(event.payload);
        } else {
          const snapshot = await workDaySnapshot(event.aggregate_id);
          const mappings = await syncWorkDaySnapshot(snapshot);
          await markTasksSynced(mappings);
        }
        await completeEvent(event);
      } catch (error) {
        await failEvent(event, error);
      }
      processed += 1;
    }
  } finally {
    running = false;
  }
  return { processed };
}

export function startSheetSyncWorker() {
  const scheduleNext = () => {
    const now = new Date();
    const next = nextIntervalDate({
      now,
      intervalDays: env.sheetSyncIntervalDays,
      anchorDate: env.sheetSyncAnchorDate,
      hour: env.sheetSyncHour,
      minute: env.sheetSyncMinute,
    });
    const delay = next.getTime() - now.getTime();
    console.log(`Próxima sincronización con Google Sheets (cada ${env.sheetSyncIntervalDays} días): ${next.toISOString()}`);
    timer = setTimeout(async () => {
      try { await processSheetOutbox(1000); } catch (error) { console.error('Error del worker programado de Google Sheets:', error); }
      scheduleNext();
    }, delay);
    timer.unref?.();
  };
  scheduleNext();
}

export function stopSheetSyncWorker() {
  if (timer) clearTimeout(timer);
}
