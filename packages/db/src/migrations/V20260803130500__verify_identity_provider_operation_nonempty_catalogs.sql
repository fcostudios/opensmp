DO $verify_identity_provider_operation_nonempty_catalogs$
DECLARE
  actual jsonb;
  expected jsonb;
  failures text[] := ARRAY[]::text[];
BEGIN
  SELECT jsonb_agg(jsonb_build_array(
    constraint_row.conname,
    constraint_row.contype,
    ARRAY(
      SELECT attribute.attname
      FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, position)
      JOIN pg_attribute AS attribute
        ON attribute.attrelid = constraint_row.conrelid
        AND attribute.attnum = key.attnum
      ORDER BY key.position
    ),
    CASE WHEN constraint_row.contype = 'f'
      THEN constraint_row.confrelid::regclass::text ELSE NULL END,
    CASE WHEN constraint_row.contype = 'f' THEN ARRAY(
      SELECT attribute.attname
      FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key(attnum, position)
      JOIN pg_attribute AS attribute
        ON attribute.attrelid = constraint_row.confrelid
        AND attribute.attnum = key.attnum
      ORDER BY key.position
    ) ELSE NULL END,
    constraint_row.confupdtype,
    constraint_row.confdeltype,
    constraint_row.convalidated,
    pg_get_constraintdef(constraint_row.oid)
  ) ORDER BY constraint_row.conname)
  INTO actual
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.identity_provider_operation'::regclass;

  expected := '[
    ["identity_provider_operation_actor_user_id_fkey", "f", ["actor_user_id"], "user_account", ["id"], "a", "a", true, "FOREIGN KEY (actor_user_id) REFERENCES user_account(id)"],
    ["identity_provider_operation_attempt_count_check", "c", ["attempt_count"], null, null, " ", " ", true, "CHECK ((attempt_count >= 0))"],
    ["identity_provider_operation_company_id_fkey", "f", ["company_id"], "company", ["id"], "a", "a", true, "FOREIGN KEY (company_id) REFERENCES company(id)"],
    ["identity_provider_operation_idempotency_key_key", "u", ["idempotency_key"], null, null, " ", " ", true, "UNIQUE (idempotency_key)"],
    ["identity_provider_operation_kind_check", "c", ["kind"], null, null, " ", " ", true, "CHECK ((kind = ANY (ARRAY[''create_user''::text, ''disable_user''::text, ''reset_two_factor''::text])))"],
    ["identity_provider_operation_lease_pair_check", "c", ["lease_token", "lease_expires_at"], null, null, " ", " ", true, "CHECK ((((lease_token IS NULL) AND (lease_expires_at IS NULL)) OR ((lease_token IS NOT NULL) AND (lease_expires_at IS NOT NULL))))"],
    ["identity_provider_operation_pkey", "p", ["id"], null, null, " ", " ", true, "PRIMARY KEY (id)"],
    ["identity_provider_operation_status_check", "c", ["status"], null, null, " ", " ", true, "CHECK ((status = ANY (ARRAY[''pending''::text, ''provider_applied''::text, ''cleanup_pending''::text, ''compensated''::text, ''completed''::text, ''failed''::text])))"],
    ["identity_provider_operation_target_user_account_id_fkey", "f", ["target_user_account_id"], "user_account", ["id"], "a", "a", true, "FOREIGN KEY (target_user_account_id) REFERENCES user_account(id)"]
  ]'::jsonb;
  IF actual IS DISTINCT FROM expected THEN
    failures := array_append(
      failures,
      format('identity provider operation constraint contract mismatch: %s', actual)
    );
  END IF;

  SELECT jsonb_agg(jsonb_build_array(
    index_relation.relname,
    index_state.indisunique,
    index_state.indisready,
    index_state.indisvalid,
    ARRAY(
      SELECT attribute.attname
      FROM unnest(index_state.indkey::smallint[]) WITH ORDINALITY AS key(attnum, position)
      JOIN pg_attribute AS attribute
        ON attribute.attrelid = index_state.indrelid
        AND attribute.attnum = key.attnum
      ORDER BY key.position
    ),
    pg_get_expr(index_state.indpred, index_state.indrelid)
  ) ORDER BY index_relation.relname)
  INTO actual
  FROM pg_index AS index_state
  JOIN pg_class AS index_relation ON index_relation.oid = index_state.indexrelid
  WHERE index_state.indrelid = 'public.identity_provider_operation'::regclass;

  expected := '[
    ["identity_provider_operation_idempotency_key_key", true, true, true, ["idempotency_key"], null],
    ["identity_provider_operation_pkey", true, true, true, ["id"], null],
    ["idx_identity_provider_operation_retry", false, true, true, ["next_retry_at", "created_at"], "(status = ANY (ARRAY[''pending''::text, ''provider_applied''::text, ''cleanup_pending''::text]))"]
  ]'::jsonb;
  IF actual IS DISTINCT FROM expected THEN
    failures := array_append(
      failures,
      format('identity provider operation index contract mismatch: %s', actual)
    );
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION '%', array_to_string(failures, '; ');
  END IF;
END
$verify_identity_provider_operation_nonempty_catalogs$;
