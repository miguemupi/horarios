BEGIN;

ALTER TABLE work_days
  ADD COLUMN IF NOT EXISTS journey_key uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS active_task_start time,
  ADD COLUMN IF NOT EXISTS active_task_planned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now();

UPDATE work_days SET journey_key = gen_random_uuid() WHERE journey_key IS NULL;
ALTER TABLE work_days ALTER COLUMN journey_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS work_days_journey_key_unique ON work_days (journey_key);
CREATE UNIQUE INDEX IF NOT EXISTS work_days_one_open_per_user ON work_days (user_id) WHERE status = 'open';

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

CREATE TABLE IF NOT EXISTS work_day_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_day_id uuid NOT NULL REFERENCES work_days(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  event_type varchar(32) NOT NULL CHECK (event_type IN (
    'day.started', 'task.started', 'task.finished', 'task.deleted',
    'day.finished', 'day.reopened', 'day.corrected', 'presence.dismissed'
  )),
  idempotency_key uuid NOT NULL,
  device_id varchar(100),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  effective_date date NOT NULL,
  effective_time time NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS work_day_events_day_idx ON work_day_events (work_day_id, id);
CREATE INDEX IF NOT EXISTS work_day_events_user_time_idx ON work_day_events (user_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS device_presence (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  device_id varchar(100) NOT NULL,
  session_id varchar(100) NOT NULL,
  work_day_id uuid REFERENCES work_days(id) ON DELETE SET NULL,
  client_sequence bigint NOT NULL DEFAULT 0,
  last_seen timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id, session_id)
);

CREATE INDEX IF NOT EXISTS device_presence_last_seen_idx ON device_presence (last_seen DESC);
CREATE INDEX IF NOT EXISTS device_presence_work_day_idx ON device_presence (work_day_id, last_seen DESC);

CREATE TABLE IF NOT EXISTS attendance_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  work_day_id uuid REFERENCES work_days(id) ON DELETE SET NULL,
  incident_date date NOT NULL,
  incident_type varchar(40) NOT NULL CHECK (incident_type IN (
    'open_too_long', 'stale_open_day', 'task_left_open', 'overlapping_tasks', 'manual_correction'
  )),
  status varchar(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'resolved', 'dismissed')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL UNIQUE,
  reviewed_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attendance_incidents_status_idx ON attendance_incidents (status, incident_date DESC);
CREATE TRIGGER device_presence_updated_at BEFORE UPDATE ON device_presence FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER attendance_incidents_updated_at BEFORE UPDATE ON attendance_incidents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION write_audit_log()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  actor_setting text;
  actor_id uuid;
  target_id uuid;
  request_ip text;
BEGIN
  actor_setting := current_setting('app.current_user_id', true);
  IF actor_setting ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    actor_id := actor_setting::uuid;
  END IF;
  request_ip := current_setting('app.request_ip', true);
  target_id := COALESCE(NEW.id, OLD.id);
  INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, before_data, after_data, ip_address, user_agent)
  VALUES (
    actor_id,
    lower(TG_OP),
    TG_TABLE_NAME,
    target_id,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END,
    CASE WHEN request_ip ~ '^([0-9a-fA-F:.]+)$' THEN request_ip::inet END,
    NULLIF(current_setting('app.request_user_agent', true), '')
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

INSERT INTO schema_migrations (version) VALUES ('005_server_work_state') ON CONFLICT (version) DO NOTHING;

COMMIT;
