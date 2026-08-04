DO $verify_capacity_recovery_routing_correction$
DECLARE
  deprecated_source text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid='public.capacity_recovery_work'::regclass
      AND attname='release_event_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'capacity recovery release identity column missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.capacity_recovery_work'::regclass
      AND conname='capacity_recovery_release_identity_check'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'capacity recovery release identity constraint missing';
  END IF;
  IF to_regprocedure(
    'public.enqueue_capacity_recovery(uuid,uuid,uuid,date,text,timestamptz,uuid)'
  ) IS NULL OR NOT has_function_privilege(
    'ledger_app',
    'public.enqueue_capacity_recovery(uuid,uuid,uuid,date,text,timestamptz,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'event-identified capacity recovery enqueue privilege missing';
  END IF;
  IF has_function_privilege(
    'ledger_app',
    'public.recover_blocked_requests_for_capacity(uuid,uuid,uuid,date,uuid[],timestamptz)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'deprecated partial capacity recovery router remains executable';
  END IF;
  SELECT prosrc INTO deprecated_source
  FROM pg_proc
  WHERE oid='public.recover_blocked_requests_for_capacity(uuid,uuid,uuid,date,uuid[],timestamptz)'::regprocedure;
  IF position('CAPACITY_RECOVERY_USE_APPLICATION_ROUTER' IN deprecated_source)=0 THEN
    RAISE EXCEPTION 'deprecated partial capacity recovery router is not fail-closed';
  END IF;
END
$verify_capacity_recovery_routing_correction$;
