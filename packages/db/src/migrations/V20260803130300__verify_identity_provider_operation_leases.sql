DO $verify_identity_provider_operation_contract$
DECLARE
  actual jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_array(
    attribute.attname,
    format_type(attribute.atttypid, attribute.atttypmod),
    attribute.attnotnull,
    pg_get_expr(default_value.adbin, default_value.adrelid)
  ) ORDER BY attribute.attnum)
  INTO actual
  FROM pg_attribute AS attribute
  LEFT JOIN pg_attrdef AS default_value
    ON default_value.adrelid = attribute.attrelid
    AND default_value.adnum = attribute.attnum
  WHERE attribute.attrelid = 'public.identity_provider_operation'::regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF actual <> '[
    ["id", "uuid", true, "gen_random_uuid()"],
    ["idempotency_key", "text", true, null],
    ["kind", "text", true, null],
    ["status", "text", true, null],
    ["actor_user_id", "uuid", true, null],
    ["target_user_account_id", "uuid", false, null],
    ["company_id", "uuid", false, null],
    ["provider_subject", "text", false, null],
    ["payload", "jsonb", true, null],
    ["attempt_count", "integer", true, "0"],
    ["last_attempted_at", "timestamp with time zone", false, null],
    ["next_retry_at", "timestamp with time zone", false, null],
    ["original_failure", "text", false, null],
    ["cleanup_failure", "text", false, null],
    ["created_at", "timestamp with time zone", true, null],
    ["completed_at", "timestamp with time zone", false, null],
    ["lease_token", "uuid", false, null],
    ["lease_expires_at", "timestamp with time zone", false, null]
  ]'::jsonb THEN
    RAISE EXCEPTION 'identity provider operation column contract mismatch: %', actual;
  END IF;

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
  WHERE constraint_row.conrelid = 'public.identity_provider_operation'::regclass
    AND constraint_row.contype IN ('c', 'f');

  IF actual <> '[
    ["identity_provider_operation_actor_user_id_fkey", "f", ["actor_user_id"], "user_account", ["id"], "a", "a", true, "FOREIGN KEY (actor_user_id) REFERENCES user_account(id)"],
    ["identity_provider_operation_attempt_count_check", "c", ["attempt_count"], null, null, " ", " ", true, "CHECK ((attempt_count >= 0))"],
    ["identity_provider_operation_company_id_fkey", "f", ["company_id"], "company", ["id"], "a", "a", true, "FOREIGN KEY (company_id) REFERENCES company(id)"],
    ["identity_provider_operation_kind_check", "c", ["kind"], null, null, " ", " ", true, "CHECK ((kind = ANY (ARRAY[''create_user''::text, ''disable_user''::text, ''reset_two_factor''::text])))"],
    ["identity_provider_operation_lease_pair_check", "c", ["lease_token", "lease_expires_at"], null, null, " ", " ", true, "CHECK ((((lease_token IS NULL) AND (lease_expires_at IS NULL)) OR ((lease_token IS NOT NULL) AND (lease_expires_at IS NOT NULL))))"],
    ["identity_provider_operation_status_check", "c", ["status"], null, null, " ", " ", true, "CHECK ((status = ANY (ARRAY[''pending''::text, ''provider_applied''::text, ''cleanup_pending''::text, ''compensated''::text, ''completed''::text, ''failed''::text])))"],
    ["identity_provider_operation_target_user_account_id_fkey", "f", ["target_user_account_id"], "user_account", ["id"], "a", "a", true, "FOREIGN KEY (target_user_account_id) REFERENCES user_account(id)"]
  ]'::jsonb THEN
    RAISE EXCEPTION 'identity provider operation constraint contract mismatch: %', actual;
  END IF;

  SELECT jsonb_agg(privilege_type ORDER BY privilege_type)
  INTO actual
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'identity_provider_operation'
    AND grantee = 'ledger_app';
  IF actual <> '["INSERT", "SELECT", "UPDATE"]'::jsonb THEN
    RAISE EXCEPTION 'identity provider operation runtime grant mismatch: %', actual;
  END IF;

  SELECT jsonb_build_array(
    pg_get_userbyid(table_relation.relowner),
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
  )
  INTO actual
  FROM pg_index AS index_state
  JOIN pg_class AS index_relation ON index_relation.oid = index_state.indexrelid
  JOIN pg_class AS table_relation ON table_relation.oid = index_state.indrelid
  WHERE index_state.indrelid = 'public.identity_provider_operation'::regclass
    AND index_relation.relname = 'idx_identity_provider_operation_retry';
  IF actual <> '[
    "ledger_owner",
    true,
    true,
    ["next_retry_at", "created_at"],
    "(status = ANY (ARRAY[''pending''::text, ''provider_applied''::text, ''cleanup_pending''::text]))"
  ]'::jsonb THEN
    RAISE EXCEPTION 'identity provider operation owner/index contract mismatch: %', actual;
  END IF;
END
$verify_identity_provider_operation_contract$;
