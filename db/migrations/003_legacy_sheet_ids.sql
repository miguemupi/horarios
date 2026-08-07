BEGIN;

ALTER TABLE work_tasks DROP CONSTRAINT IF EXISTS work_tasks_sheet_record_id_key;

UPDATE work_tasks
SET sheet_record_id = sheet_record_id || '::row:' || sheet_row_number
WHERE client_entry_id LIKE 'legacy:%'
  AND sheet_row_number IS NOT NULL
  AND sheet_record_id NOT LIKE '%::row:%';

DELETE FROM sheet_sync_outbox o
WHERE EXISTS (
  SELECT 1 FROM work_days d
  WHERE d.id = o.aggregate_id
    AND NOT EXISTS (SELECT 1 FROM work_tasks t WHERE t.work_day_id = d.id)
);

DELETE FROM work_days d
WHERE NOT EXISTS (SELECT 1 FROM work_tasks t WHERE t.work_day_id = d.id);

INSERT INTO schema_migrations (version) VALUES ('003_legacy_sheet_ids') ON CONFLICT (version) DO NOTHING;

COMMIT;
