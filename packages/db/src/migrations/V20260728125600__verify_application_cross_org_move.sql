DO $$
DECLARE
  function_count integer;
  index_count integer;
BEGIN
  SELECT count(*)::integer
    INTO function_count
  FROM pg_proc procedure
  JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'execute_cross_org_move';

  SELECT count(*)::integer
    INTO index_count
  FROM pg_index index_state
  JOIN pg_class index_relation ON index_relation.oid = index_state.indexrelid
  JOIN pg_class table_relation ON table_relation.oid = index_state.indrelid
  WHERE table_relation.relname = 'audit_log'
    AND index_relation.relname = 'uq_cross_org_move_client_request'
    AND index_state.indisunique
    AND index_state.indnkeyatts = 2
    AND pg_get_indexdef(index_state.indexrelid) =
      'CREATE UNIQUE INDEX uq_cross_org_move_client_request ON public.audit_log USING btree (entity_id, ((after ->> ''clientRequestId''::text))) WHERE ((entity_type = ''CrossOrgMove''::text) AND ((after ->> ''clientRequestId''::text) IS NOT NULL))'
    AND pg_get_expr(index_state.indpred, index_state.indrelid) =
      '((entity_type = ''CrossOrgMove''::text) AND ((after ->> ''clientRequestId''::text) IS NOT NULL))';

  IF function_count <> 0
     OR index_count <> 1
     OR NOT has_table_privilege(
       'ledger_app',
       'public.license_request',
       'SELECT,INSERT,UPDATE'
     )
     OR NOT has_table_privilege(
       'ledger_app',
       'public.request_transition',
       'SELECT,INSERT'
     )
     OR NOT has_table_privilege(
       'ledger_app',
       'public.provisioning_action',
       'SELECT,INSERT'
     )
     OR NOT has_table_privilege(
       'ledger_app',
       'public.audit_log',
       'SELECT,INSERT'
     )
     OR NOT has_table_privilege(
       'ledger_app',
       'public.license_assignment',
       'SELECT'
     )
     OR NOT has_table_privilege(
       'ledger_app',
       'public.person',
       'SELECT'
     )
     OR NOT has_table_privilege(
       'ledger_app',
       'public.company',
       'SELECT'
     )
     OR NOT has_table_privilege(
       'ledger_app',
       'public.vendor_account',
       'SELECT'
     )
     OR NOT has_table_privilege(
       'ledger_app',
       'public.vendor',
       'SELECT'
     )
     OR NOT has_table_privilege(
       'ledger_app',
       'public.license_type',
       'SELECT'
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'application cross-organization move verification failed';
  END IF;
END
$$;
