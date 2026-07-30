DO $$
DECLARE
  index_count integer;
BEGIN
  IF to_regprocedure(
    'public.execute_cross_org_move(uuid,uuid,date,text,uuid)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE =
        'cross-org move runtime privilege verification failed: function present';
  END IF;

  SELECT count(*)::integer
    INTO index_count
  FROM pg_index index_state
  JOIN pg_class index_relation ON index_relation.oid = index_state.indexrelid
  JOIN pg_class table_relation ON table_relation.oid = index_state.indrelid
  JOIN pg_namespace namespace ON namespace.oid = table_relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND table_relation.relname = 'audit_log'
    AND index_relation.relname = 'uq_cross_org_move_client_request'
    AND index_state.indisunique
    AND index_state.indisvalid
    AND index_state.indisready
    AND index_state.indnkeyatts = 2
    AND pg_get_indexdef(index_state.indexrelid) =
      'CREATE UNIQUE INDEX uq_cross_org_move_client_request ON public.audit_log USING btree (entity_id, ((after ->> ''clientRequestId''::text))) WHERE ((entity_type = ''CrossOrgMove''::text) AND ((after ->> ''clientRequestId''::text) IS NOT NULL))'
    AND pg_get_expr(index_state.indpred, index_state.indrelid) =
      '((entity_type = ''CrossOrgMove''::text) AND ((after ->> ''clientRequestId''::text) IS NOT NULL))';

  IF index_count <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE =
        'cross-org move runtime privilege verification failed: idempotency index';
  END IF;

  IF NOT has_table_privilege(
    'ledger_app', 'public.license_request', 'SELECT'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'cross-org move runtime privilege verification failed: license_request SELECT';
  END IF;
  IF NOT has_table_privilege(
    'ledger_app', 'public.license_request', 'INSERT'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'cross-org move runtime privilege verification failed: license_request INSERT';
  END IF;
  IF NOT has_table_privilege(
    'ledger_app', 'public.license_request', 'UPDATE'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'cross-org move runtime privilege verification failed: license_request UPDATE';
  END IF;

  IF NOT has_table_privilege(
    'ledger_app', 'public.request_transition', 'SELECT'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'cross-org move runtime privilege verification failed: request_transition SELECT';
  END IF;
  IF NOT has_table_privilege(
    'ledger_app', 'public.request_transition', 'INSERT'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'cross-org move runtime privilege verification failed: request_transition INSERT';
  END IF;

  IF NOT has_table_privilege(
    'ledger_app', 'public.provisioning_action', 'SELECT'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'cross-org move runtime privilege verification failed: provisioning_action SELECT';
  END IF;
  IF NOT has_table_privilege(
    'ledger_app', 'public.provisioning_action', 'INSERT'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'cross-org move runtime privilege verification failed: provisioning_action INSERT';
  END IF;

  IF NOT has_table_privilege(
    'ledger_app', 'public.audit_log', 'SELECT'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'cross-org move runtime privilege verification failed: audit_log SELECT';
  END IF;
  IF NOT has_table_privilege(
    'ledger_app', 'public.audit_log', 'INSERT'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'cross-org move runtime privilege verification failed: audit_log INSERT';
  END IF;

  IF NOT has_table_privilege(
    'ledger_app', 'public.license_assignment', 'SELECT'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'cross-org move runtime privilege verification failed: license_assignment SELECT';
  END IF;
  IF NOT has_table_privilege(
    'ledger_app', 'public.person', 'SELECT'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'cross-org move runtime privilege verification failed: person SELECT';
  END IF;
  IF NOT has_table_privilege(
    'ledger_app', 'public.company', 'SELECT'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'cross-org move runtime privilege verification failed: company SELECT';
  END IF;
  IF NOT has_table_privilege(
    'ledger_app', 'public.vendor_account', 'SELECT'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'cross-org move runtime privilege verification failed: vendor_account SELECT';
  END IF;
  IF NOT has_table_privilege(
    'ledger_app', 'public.vendor', 'SELECT'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'cross-org move runtime privilege verification failed: vendor SELECT';
  END IF;
  IF NOT has_table_privilege(
    'ledger_app', 'public.license_type', 'SELECT'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'cross-org move runtime privilege verification failed: license_type SELECT';
  END IF;
END
$$;
