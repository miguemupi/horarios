BEGIN;

DO $$
DECLARE
  smoke_user_id uuid;
  smoke_business_id uuid;
  smoke_day_id uuid;
  audit_count integer;
  outbox_count integer;
BEGIN
  INSERT INTO app_users (username, display_name, password_hash, role)
  VALUES ('schema_smoke', 'Prueba de esquema', 'not-a-real-password-hash', 'employee')
  RETURNING id INTO smoke_user_id;

  PERFORM set_config('app.current_user_id', smoke_user_id::text, true);

  INSERT INTO businesses (name)
  VALUES ('Negocio de prueba de esquema')
  RETURNING id INTO smoke_business_id;

  INSERT INTO work_days (user_id, work_date, day_start)
  VALUES (smoke_user_id, DATE '2099-01-01', TIME '09:00:00')
  RETURNING id INTO smoke_day_id;

  INSERT INTO work_tasks (
    work_day_id,
    business_id,
    business_name,
    description,
    start_time,
    end_time,
    duration_seconds,
    position
  ) VALUES (
    smoke_day_id,
    smoke_business_id,
    'Negocio de prueba de esquema',
    'Tarea de comprobacion',
    TIME '09:00:00',
    TIME '10:30:15',
    5415,
    1
  );

  UPDATE work_days
  SET day_end = TIME '17:00:00',
      status = 'submitted',
      employee_signature = 'Prueba de esquema',
      submitted_at = now()
  WHERE id = smoke_day_id;

  SELECT count(*) INTO audit_count
  FROM audit_log
  WHERE actor_user_id = smoke_user_id;

  SELECT count(*) INTO outbox_count
  FROM sheet_sync_outbox
  WHERE aggregate_id = smoke_day_id
    AND status = 'pending';

  IF audit_count < 4 THEN
    RAISE EXCEPTION 'Auditoria incompleta: se esperaban al menos 4 eventos y hay %', audit_count;
  END IF;

  IF outbox_count <> 1 THEN
    RAISE EXCEPTION 'Outbox incorrecto: se esperaba 1 evento y hay %', outbox_count;
  END IF;

  RAISE NOTICE 'Smoke test correcto: % eventos de auditoria y % evento de outbox', audit_count, outbox_count;
END;
$$;

ROLLBACK;
