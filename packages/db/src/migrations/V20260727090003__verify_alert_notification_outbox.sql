-- Fail closed if the append-only delivery journal drifts during release.
DO $$
DECLARE
  table_owner name;
  trigger_enabled "char";
  success_index boolean;
BEGIN
  SELECT pg_get_userbyid(class.relowner)
    INTO table_owner
  FROM pg_class class
  JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
  WHERE namespace.nspname = 'public'
    AND class.relname = 'alert_notification_delivery'
    AND class.relkind = 'r';

  SELECT trigger.tgenabled
    INTO trigger_enabled
  FROM pg_trigger trigger
  JOIN pg_class class ON class.oid = trigger.tgrelid
  JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
  WHERE namespace.nspname = 'public'
    AND class.relname = 'alert_notification_delivery'
    AND trigger.tgname = 'trg_alert_notification_delivery_append_only'
    AND NOT trigger.tgisinternal;

  SELECT index_state.indisunique
    INTO success_index
  FROM pg_index index_state
  JOIN pg_class index_class ON index_class.oid = index_state.indexrelid
  WHERE index_class.relname = 'uq_alert_notification_delivery_succeeded'
    AND pg_get_expr(index_state.indpred, index_state.indrelid) = '(phase = ''succeeded''::alert_notification_delivery_phase_enum)';

  IF table_owner IS NULL
    OR table_owner <> current_user
    OR trigger_enabled IS DISTINCT FROM 'O'
    OR success_index IS DISTINCT FROM true
    OR has_table_privilege('ledger_app', 'alert_notification_delivery', 'UPDATE')
    OR has_table_privilege('ledger_app', 'alert_notification_delivery', 'DELETE')
    OR NOT has_table_privilege('ledger_app', 'alert_notification_delivery', 'SELECT')
    OR NOT has_table_privilege('ledger_app', 'alert_notification_delivery', 'INSERT')
  THEN
    RAISE EXCEPTION 'Alert notification outbox verification failed';
  END IF;
END
$$;
