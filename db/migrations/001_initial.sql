BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar(32) NOT NULL,
  display_name varchar(120) NOT NULL,
  password_hash text NOT NULL,
  role varchar(16) NOT NULL DEFAULT 'employee' CHECK (role IN ('employee', 'manager', 'admin')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (username = lower(username)),
  CHECK (username ~ '^[a-z0-9][a-z0-9._-]+$')
);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_unique ON app_users (lower(username));

CREATE TABLE IF NOT EXISTS businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS businesses_name_unique ON businesses (lower(name));

CREATE TABLE IF NOT EXISTS work_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  work_date date NOT NULL,
  timezone varchar(64) NOT NULL DEFAULT 'Europe/Madrid',
  day_start time NOT NULL,
  day_end time,
  status varchar(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'corrected')),
  employee_signature varchar(200),
  manager_signature varchar(200),
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, work_date),
  CHECK ((status = 'open') OR day_end IS NOT NULL),
  CHECK ((status = 'open') OR employee_signature IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS work_days_date_idx ON work_days (work_date DESC);
CREATE INDEX IF NOT EXISTS work_days_user_date_idx ON work_days (user_id, work_date DESC);
CREATE INDEX IF NOT EXISTS work_days_status_idx ON work_days (status);

CREATE TABLE IF NOT EXISTS work_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_day_id uuid NOT NULL REFERENCES work_days(id) ON DELETE CASCADE,
  business_id uuid REFERENCES businesses(id) ON DELETE SET NULL,
  business_name varchar(120) NOT NULL,
  description text NOT NULL,
  material text NOT NULL DEFAULT '',
  start_time time NOT NULL,
  end_time time NOT NULL,
  duration_seconds integer NOT NULL CHECK (duration_seconds > 0 AND duration_seconds <= 86400),
  position smallint NOT NULL CHECK (position > 0),
  sheet_row_number integer CHECK (sheet_row_number IS NULL OR sheet_row_number >= 2),
  sheet_record_id text,
  sheet_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_day_id, position),
  UNIQUE (sheet_record_id)
);

CREATE INDEX IF NOT EXISTS work_tasks_day_idx ON work_tasks (work_day_id, position);
CREATE INDEX IF NOT EXISTS work_tasks_business_idx ON work_tasks (business_id);
CREATE INDEX IF NOT EXISTS work_tasks_sheet_pending_idx ON work_tasks (sheet_synced_at) WHERE sheet_synced_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  action varchar(16) NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  entity_type varchar(64) NOT NULL,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);

CREATE TABLE IF NOT EXISTS sheet_sync_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aggregate_type varchar(64) NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type varchar(64) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL UNIQUE,
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'synced', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz
);

CREATE INDEX IF NOT EXISTS sheet_sync_outbox_ready_idx
  ON sheet_sync_outbox (next_attempt_at, id)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS sheet_sync_outbox_aggregate_idx
  ON sheet_sync_outbox (aggregate_type, aggregate_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

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
  target_id := COALESCE(NEW.id, OLD.id);
  INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, before_data, after_data)
  VALUES (
    actor_id,
    lower(TG_OP),
    TG_TABLE_NAME,
    target_id,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_sheet_sync()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_day_id uuid;
  target_status text;
BEGIN
  IF TG_TABLE_NAME = 'work_days' THEN
    target_day_id := COALESCE(NEW.id, OLD.id);
    target_status := COALESCE(NEW.status, OLD.status);
  ELSE
    target_day_id := COALESCE(NEW.work_day_id, OLD.work_day_id);
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
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS app_users_updated_at ON app_users;
CREATE TRIGGER app_users_updated_at BEFORE UPDATE ON app_users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS businesses_updated_at ON businesses;
CREATE TRIGGER businesses_updated_at BEFORE UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS work_days_updated_at ON work_days;
CREATE TRIGGER work_days_updated_at BEFORE UPDATE ON work_days FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS work_tasks_updated_at ON work_tasks;
CREATE TRIGGER work_tasks_updated_at BEFORE UPDATE ON work_tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS sheet_sync_outbox_updated_at ON sheet_sync_outbox;
CREATE TRIGGER sheet_sync_outbox_updated_at BEFORE UPDATE ON sheet_sync_outbox FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS app_users_audit ON app_users;
CREATE TRIGGER app_users_audit AFTER INSERT OR UPDATE OR DELETE ON app_users FOR EACH ROW EXECUTE FUNCTION write_audit_log();
DROP TRIGGER IF EXISTS businesses_audit ON businesses;
CREATE TRIGGER businesses_audit AFTER INSERT OR UPDATE OR DELETE ON businesses FOR EACH ROW EXECUTE FUNCTION write_audit_log();
DROP TRIGGER IF EXISTS work_days_audit ON work_days;
CREATE TRIGGER work_days_audit AFTER INSERT OR UPDATE OR DELETE ON work_days FOR EACH ROW EXECUTE FUNCTION write_audit_log();
DROP TRIGGER IF EXISTS work_tasks_audit ON work_tasks;
CREATE TRIGGER work_tasks_audit AFTER INSERT OR UPDATE OR DELETE ON work_tasks FOR EACH ROW EXECUTE FUNCTION write_audit_log();

DROP TRIGGER IF EXISTS work_days_sheet_sync ON work_days;
CREATE TRIGGER work_days_sheet_sync AFTER INSERT OR UPDATE ON work_days FOR EACH ROW EXECUTE FUNCTION enqueue_sheet_sync();
DROP TRIGGER IF EXISTS work_tasks_sheet_sync ON work_tasks;
CREATE TRIGGER work_tasks_sheet_sync AFTER INSERT OR UPDATE OR DELETE ON work_tasks FOR EACH ROW EXECUTE FUNCTION enqueue_sheet_sync();

INSERT INTO schema_migrations (version) VALUES ('001_initial') ON CONFLICT (version) DO NOTHING;

COMMIT;
