BEGIN;

ALTER TABLE work_tasks ADD COLUMN IF NOT EXISTS client_entry_id text;

CREATE UNIQUE INDEX IF NOT EXISTS work_tasks_client_entry_unique
  ON work_tasks (work_day_id, client_entry_id)
  WHERE client_entry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION write_audit_log()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  actor_setting text;
  actor_id uuid;
  target_id uuid;
BEGIN
  actor_setting := current_setting('app.current_user_id', true);
  IF actor_setting ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    actor_id := actor_setting::uuid;
  END IF;
  IF TG_OP = 'DELETE' THEN target_id := OLD.id; ELSE target_id := NEW.id; END IF;
  INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, before_data, after_data)
  VALUES (
    actor_id,
    lower(TG_OP),
    TG_TABLE_NAME,
    target_id,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_sheet_sync()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_day_id uuid;
  target_status text;
BEGIN
  IF TG_TABLE_NAME = 'work_days' THEN
    target_day_id := NEW.id;
    target_status := NEW.status;
  ELSE
    IF TG_OP = 'UPDATE'
      AND NEW.work_day_id IS NOT DISTINCT FROM OLD.work_day_id
      AND NEW.business_id IS NOT DISTINCT FROM OLD.business_id
      AND NEW.business_name IS NOT DISTINCT FROM OLD.business_name
      AND NEW.description IS NOT DISTINCT FROM OLD.description
      AND NEW.material IS NOT DISTINCT FROM OLD.material
      AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time
      AND NEW.end_time IS NOT DISTINCT FROM OLD.end_time
      AND NEW.duration_seconds IS NOT DISTINCT FROM OLD.duration_seconds
      AND NEW.position IS NOT DISTINCT FROM OLD.position THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN target_day_id := OLD.work_day_id; ELSE target_day_id := NEW.work_day_id; END IF;
    SELECT status INTO target_status FROM work_days WHERE id = target_day_id;
  END IF;

  IF target_status IN ('submitted', 'corrected') THEN
    INSERT INTO sheet_sync_outbox (aggregate_type, aggregate_id, event_type, payload, dedupe_key)
    VALUES (
      'work_day',
      target_day_id,
      'work_day.sync_requested',
      jsonb_build_object('work_day_id', target_day_id, 'source_table', TG_TABLE_NAME, 'operation', lower(TG_OP)),
      'work-day:' || target_day_id || ':tx:' || txid_current()
    )
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

INSERT INTO schema_migrations (version) VALUES ('002_database_source') ON CONFLICT (version) DO NOTHING;

COMMIT;
