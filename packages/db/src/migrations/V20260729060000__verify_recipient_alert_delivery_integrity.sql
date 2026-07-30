-- US-017: persistently reject drift in the recipient-scoped alert delivery
-- authority and its attempt/recipient fencing objects.
DO $$
DECLARE
  recipient_function_count integer;
BEGIN
  SELECT count(*)::integer
  INTO recipient_function_count
  FROM pg_proc function_row
  JOIN pg_namespace namespace ON namespace.oid = function_row.pronamespace
  WHERE namespace.nspname = 'public'
    AND (
      (
        function_row.proname = 'append_alert_recipient_pending'
        AND pg_get_function_identity_arguments(function_row.oid) =
          'p_alert_event_id uuid, p_recipient_key text, p_recipient_user_account_id uuid, p_recipient_email text, p_recipient_locale user_account_ui_language_enum, p_occurred_at timestamp with time zone'
        AND position('p_recipient_key' in function_row.prosrc) > 0
        AND position('pg_advisory_xact_lock' in function_row.prosrc) > 0
        AND position('recipient_user_account_id' in function_row.prosrc) > 0
        AND position('recipient_email' in function_row.prosrc) > 0
        AND position('recipient_locale' in function_row.prosrc) > 0
        AND position(
          'alert_event_id, recipient_key, recipient_user_account_id'
          in function_row.prosrc
        ) > 0
        AND position(
          'INSERT INTO public.alert_notification_delivery'
          in function_row.prosrc
        ) > 0
      )
      OR (
        function_row.proname = 'claim_alert_recipient_delivery'
        AND pg_get_function_identity_arguments(function_row.oid) =
          'p_alert_event_id uuid, p_recipient_key text, p_occurred_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_worker_id text'
        AND position(
          'p_lease_expires_at <= p_occurred_at' in function_row.prosrc
        ) > 0
        AND position('btrim(p_recipient_key)' in function_row.prosrc) > 0
        AND position('pg_advisory_xact_lock' in function_row.prosrc) > 0
        AND position(
          'delivery.recipient_key = p_recipient_key' in function_row.prosrc
        ) > 0
        AND position('gen_random_uuid' in function_row.prosrc) > 0
        AND position(
          'alert_event_id, recipient_key, attempt, phase'
          in function_row.prosrc
        ) > 0
        AND position(
          'INSERT INTO public.alert_notification_delivery'
          in function_row.prosrc
        ) > 0
      )
      OR (
        function_row.proname = 'complete_alert_recipient_delivery'
        AND pg_get_function_identity_arguments(function_row.oid) =
          'p_alert_event_id uuid, p_recipient_key text, p_attempt integer, p_claim_token uuid, p_occurred_at timestamp with time zone, p_phase alert_notification_delivery_phase_enum, p_provider_message_id text, p_accepted jsonb, p_error_code text'
        AND position('p_phase NOT IN' in function_row.prosrc) > 0
        AND position('p_recipient_key' in function_row.prosrc) > 0
        AND position('pg_advisory_xact_lock' in function_row.prosrc) > 0
        AND position(
          'alert_event_id, recipient_key, attempt, phase'
          in function_row.prosrc
        ) > 0
        AND position(
          'INSERT INTO public.alert_notification_delivery'
          in function_row.prosrc
        ) > 0
      )
    )
    AND function_row.prosecdef
    AND function_row.proowner = (
      SELECT oid FROM pg_roles WHERE rolname = 'ledger_owner'
    )
    AND function_row.proconfig = ARRAY['search_path=pg_catalog, public']
    AND NOT has_function_privilege('public', function_row.oid, 'EXECUTE')
    AND has_function_privilege('ledger_app', function_row.oid, 'EXECUTE')
    AND NOT EXISTS (
      SELECT 1
      FROM aclexplode(coalesce(
        function_row.proacl,
        acldefault('f', function_row.proowner)
      )) function_acl
      WHERE function_acl.privilege_type = 'EXECUTE'
        AND function_acl.grantee NOT IN (
          function_row.proowner,
          (SELECT oid FROM pg_roles WHERE rolname = 'ledger_app')
        )
    );

  IF recipient_function_count <> 3 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'recipient_alert_delivery_functions',
      MESSAGE =
        'Recipient alert delivery SECURITY DEFINER verification failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid =
        'public.alert_notification_delivery'::regclass
      AND constraint_row.conname =
        'ck_alert_notification_delivery_recipient'
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
      AND pg_get_constraintdef(constraint_row.oid, true) =
        'CHECK (btrim(recipient_key) <> ''''::text AND (phase <> ''pending''::alert_notification_delivery_phase_enum OR recipient_email IS NULL OR btrim(recipient_email) <> ''''::text))'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'recipient_alert_delivery_constraint',
      MESSAGE = 'Recipient alert delivery constraint verification failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index index_state
    JOIN pg_class index_relation
      ON index_relation.oid = index_state.indexrelid
    WHERE index_state.indrelid =
        'public.alert_notification_delivery'::regclass
      AND index_relation.relname =
        'uq_alert_notification_delivery_attempt_phase'
      AND index_state.indisunique
      AND index_state.indisvalid
      AND index_state.indisready
      AND index_state.indnkeyatts = 4
      AND ARRAY(
        SELECT pg_get_indexdef(
          index_state.indexrelid,
          key_position,
          true
        )
        FROM generate_series(1, index_state.indnkeyatts) key_position
      ) = ARRAY[
        'alert_event_id',
        'recipient_key',
        'attempt',
        'phase'
      ]
      AND index_state.indpred IS NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_index index_state
    JOIN pg_class index_relation
      ON index_relation.oid = index_state.indexrelid
    WHERE index_state.indrelid =
        'public.alert_notification_delivery'::regclass
      AND index_relation.relname =
        'uq_alert_notification_delivery_succeeded'
      AND index_state.indisunique
      AND index_state.indisvalid
      AND index_state.indisready
      AND index_state.indnkeyatts = 2
      AND ARRAY(
        SELECT pg_get_indexdef(
          index_state.indexrelid,
          key_position,
          true
        )
        FROM generate_series(1, index_state.indnkeyatts) key_position
      ) = ARRAY['alert_event_id', 'recipient_key']
      AND pg_get_expr(
        index_state.indpred,
        index_state.indrelid,
        true
      ) = 'phase = ''succeeded''::alert_notification_delivery_phase_enum'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_index index_state
    JOIN pg_class index_relation
      ON index_relation.oid = index_state.indexrelid
    WHERE index_state.indrelid =
        'public.alert_notification_delivery'::regclass
      AND index_relation.relname =
        'idx_alert_notification_delivery_claim_fence'
      AND NOT index_state.indisunique
      AND index_state.indisvalid
      AND index_state.indisready
      AND index_state.indnkeyatts = 4
      AND ARRAY(
        SELECT pg_get_indexdef(
          index_state.indexrelid,
          key_position,
          true
        )
        FROM generate_series(1, index_state.indnkeyatts) key_position
      ) = ARRAY[
        'alert_event_id',
        'recipient_key',
        'attempt',
        'claim_token'
      ]
      AND index_state.indpred IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'recipient_alert_delivery_indexes',
      MESSAGE = 'Recipient alert delivery index verification failed';
  END IF;
END
$$;
