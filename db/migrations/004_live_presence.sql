BEGIN;

CREATE TABLE IF NOT EXISTS live_presence (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  journey_key varchar(100) NOT NULL,
  work_date date NOT NULL,
  day_start time NOT NULL,
  task_start time NOT NULL,
  active_task boolean NOT NULL DEFAULT false,
  planned boolean NOT NULL DEFAULT false,
  dismissed boolean NOT NULL DEFAULT false,
  last_seen timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS live_presence_updated_at ON live_presence;
CREATE TRIGGER live_presence_updated_at BEFORE UPDATE ON live_presence FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO schema_migrations (version) VALUES ('004_live_presence') ON CONFLICT (version) DO NOTHING;

COMMIT;
