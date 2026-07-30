-- US-017: fail release if recipient fencing, least privilege, or the canonical
-- approval-aging default drifted.
DO $$
DECLARE
  recipient_column_count integer;
  recipient_function_count integer;
BEGIN
  SELECT count(*)::integer
  INTO recipient_column_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'alert_notification_delivery'
    AND column_name IN (
      'recipient_key',
      'recipient_user_account_id',
      'recipient_email',
      'recipient_locale'
    );

  SELECT count(*)::integer
  INTO recipient_function_count
  FROM pg_proc function_row
  JOIN pg_namespace namespace ON namespace.oid = function_row.pronamespace
  WHERE namespace.nspname = 'public'
    AND function_row.proname IN (
      'append_alert_recipient_pending',
      'claim_alert_recipient_delivery',
      'complete_alert_recipient_delivery'
    )
    AND function_row.prosecdef
    AND function_row.proowner = (
      SELECT oid FROM pg_roles WHERE rolname = 'ledger_owner'
    )
    AND function_row.proconfig = ARRAY['search_path=pg_catalog, public']
    AND NOT has_function_privilege('public', function_row.oid, 'EXECUTE')
    AND has_function_privilege('ledger_app', function_row.oid, 'EXECUTE');

  IF recipient_column_count <> 4
    OR recipient_function_count <> 3
    OR NOT EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'uq_alert_notification_delivery_attempt_phase'
        AND indexdef LIKE
          '%(alert_event_id, recipient_key, attempt, phase)%'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM alert_rule
      WHERE id = '00000000-0000-4000-8000-000000004201'::uuid
        AND type = 'approval_aging'
        AND threshold = '{"hours":24,"escalationHours":48}'::jsonb
    )
    OR has_table_privilege(
      'ledger_app', 'public.alert_notification_delivery', 'INSERT'
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'scoped_approval_aging_breaches',
      MESSAGE = 'Approval-aging recipient scope verification failed';
  END IF;
END
$$;
