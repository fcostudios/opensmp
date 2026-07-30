-- US-042: fail release if the least-privilege journal boundary drifts.
DO $$
DECLARE
  hardened_function_count integer;
  insert_trigger_enabled "char";
  claim_fence_constraint boolean;
BEGIN
  SELECT count(*)::integer
  INTO hardened_function_count
  FROM pg_proc function_row
  JOIN pg_namespace namespace ON namespace.oid = function_row.pronamespace
  WHERE namespace.nspname = 'public'
    AND function_row.proname IN (
      'append_alert_delivery_pending',
      'claim_alert_delivery',
      'complete_alert_delivery'
    )
    AND function_row.prosecdef
    AND function_row.proowner = (
      SELECT oid FROM pg_roles WHERE rolname = 'ledger_owner'
    )
    AND function_row.proconfig = ARRAY['search_path=pg_catalog, public']
    AND NOT has_function_privilege(
      'public',
      function_row.oid,
      'EXECUTE'
    )
    AND has_function_privilege(
      'ledger_app',
      function_row.oid,
      'EXECUTE'
    );

  SELECT trigger.tgenabled
  INTO insert_trigger_enabled
  FROM pg_trigger trigger
  WHERE trigger.tgrelid = 'public.alert_notification_delivery'::regclass
    AND trigger.tgname = 'trg_alert_notification_delivery_validate_insert'
    AND NOT trigger.tgisinternal;

  SELECT constraint_row.convalidated
  INTO claim_fence_constraint
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid =
      'public.alert_notification_delivery'::regclass
    AND constraint_row.conname =
      'ck_alert_notification_delivery_claim_fence'
    AND constraint_row.contype = 'c';

  IF hardened_function_count <> 3
    OR insert_trigger_enabled IS DISTINCT FROM 'O'
    OR claim_fence_constraint IS DISTINCT FROM true
    OR has_table_privilege(
      'ledger_app', 'public.alert_notification_delivery', 'INSERT'
    )
    OR NOT has_table_privilege(
      'ledger_app', 'public.alert_notification_delivery', 'SELECT'
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'alert_notification_delivery_hardening',
      MESSAGE = 'Alert notification delivery hardening verification failed';
  END IF;
END
$$;
