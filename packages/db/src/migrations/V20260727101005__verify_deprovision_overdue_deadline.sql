-- US-042/US-024 AC4: prove both the semantic global default and every
-- persisted deprovision-overdue threshold use the canonical deadline shape.
DO $$
DECLARE
  invalid_count integer;
  global_count integer;
BEGIN
  SELECT count(*)::integer
  INTO invalid_count
  FROM alert_rule
  WHERE type = 'deprovision_overdue'
    AND threshold IS DISTINCT FROM '{"businessDays":0}'::jsonb;

  SELECT count(*)::integer
  INTO global_count
  FROM alert_rule
  WHERE type = 'deprovision_overdue'
    AND scope_kind = 'global'
    AND threshold = '{"businessDays":0}'::jsonb
    AND channel = 'email'
    AND enabled;

  IF invalid_count <> 0 OR global_count <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'deprovision_overdue_same_business_day',
      MESSAGE = 'deprovision_overdue deadline verification failed';
  END IF;
END
$$;
