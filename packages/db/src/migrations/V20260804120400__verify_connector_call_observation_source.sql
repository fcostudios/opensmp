-- US-057 Task 2 review correction: line breaks after -- are executable syntax.
-- Preserve the preceding committed verifier; supplement its catalog checks with
-- a behavior-sensitive source comparison that normalizes only outer whitespace.
DO $verify_connector_call_source$
DECLARE
  actual_source text;
BEGIN
  SELECT prosrc INTO actual_source FROM pg_proc
  WHERE oid = to_regprocedure('public.validate_connector_call_observation()');
  IF btrim(actual_source, E' \t\r\n') IS DISTINCT FROM $expected_source$DECLARE
  context_row public.connector_call_observation%ROWTYPE;
  last_attempt integer;
BEGIN
  -- A transaction-scoped lock makes concurrent appends use one correlation order.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.correlation_id::text, 57057));
  IF NEW.provisioning_action_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.provisioning_action
    WHERE id = NEW.provisioning_action_id AND vendor_account_id = NEW.vendor_account_id
  ) THEN
    RAISE EXCEPTION 'connector call action/account mismatch' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO context_row FROM public.connector_call_observation
    WHERE correlation_id = NEW.correlation_id ORDER BY attempt, phase LIMIT 1;
  IF FOUND AND (
    context_row.vendor_account_id IS DISTINCT FROM NEW.vendor_account_id
    OR context_row.operation IS DISTINCT FROM NEW.operation
    OR context_row.provisioning_action_id IS DISTINCT FROM NEW.provisioning_action_id
  ) THEN
    RAISE EXCEPTION 'connector call correlation context mismatch' USING ERRCODE = '23514';
  END IF;
  IF NEW.phase = 'requested' THEN
    SELECT COALESCE(MAX(attempt), 0) INTO last_attempt FROM public.connector_call_observation
      WHERE correlation_id = NEW.correlation_id AND phase = 'requested';
    IF NEW.attempt <> last_attempt + 1 THEN
      RAISE EXCEPTION 'connector call requested attempt must be sequential' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.connector_call_observation
      WHERE correlation_id = NEW.correlation_id AND attempt = NEW.attempt AND phase = 'requested'
    ) THEN
      RAISE EXCEPTION 'connector call terminal requires requested' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.connector_call_observation
      WHERE correlation_id = NEW.correlation_id AND attempt = NEW.attempt AND phase IN ('succeeded', 'failed')
    ) THEN
      RAISE EXCEPTION 'connector call already has terminal outcome' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;$expected_source$
  THEN RAISE EXCEPTION 'connector call validator source mismatch'; END IF;
END
$verify_connector_call_source$;

