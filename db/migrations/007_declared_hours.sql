BEGIN;

ALTER TABLE work_days
  ADD COLUMN IF NOT EXISTS declared_hours numeric(5,2);

ALTER TABLE work_days
  DROP CONSTRAINT IF EXISTS work_days_declared_hours_check;

ALTER TABLE work_days
  ADD CONSTRAINT work_days_declared_hours_check
  CHECK (declared_hours IS NULL OR (declared_hours >= 0 AND declared_hours <= 24));

INSERT INTO schema_migrations (version) VALUES ('007_declared_hours') ON CONFLICT (version) DO NOTHING;

COMMIT;
