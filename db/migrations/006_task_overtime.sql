BEGIN;

ALTER TABLE work_tasks ADD COLUMN IF NOT EXISTS is_overtime boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations (version) VALUES ('006_task_overtime') ON CONFLICT (version) DO NOTHING;

COMMIT;
