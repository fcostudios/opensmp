DO $verification$
DECLARE
  column_state record;
  index_state record;
BEGIN
  SELECT
    data_type,
    is_nullable,
    column_default
  INTO column_state
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'license_request'
    AND column_name = 'client_request_id';

  SELECT
    index_relation.relname AS index_name,
    table_relation.relname AS table_name,
    index_metadata.indisunique AS is_unique,
    index_metadata.indisvalid AS is_valid,
    index_metadata.indisready AS is_ready,
    index_metadata.indimmediate AS is_immediate,
    index_metadata.indnkeyatts AS key_count,
    index_metadata.indnatts AS attribute_count,
    access_method.amname AS access_method,
    ARRAY(
      SELECT pg_get_indexdef(
        index_metadata.indexrelid,
        key_position,
        true
      )
      FROM generate_series(
        1,
        index_metadata.indnkeyatts
      ) AS key_position
    ) AS key_expressions,
    pg_get_expr(
      index_metadata.indpred,
      index_metadata.indrelid,
      true
    ) AS predicate,
    constraint_row.contype AS constraint_type,
    constraint_row.condeferrable AS constraint_deferrable,
    constraint_row.condeferred AS constraint_initially_deferred
  INTO index_state
  FROM pg_index AS index_metadata
  JOIN pg_class AS index_relation
    ON index_relation.oid = index_metadata.indexrelid
  JOIN pg_class AS table_relation
    ON table_relation.oid = index_metadata.indrelid
  JOIN pg_namespace AS table_namespace
    ON table_namespace.oid = table_relation.relnamespace
  JOIN pg_am AS access_method
    ON access_method.oid = index_relation.relam
  LEFT JOIN pg_constraint AS constraint_row
    ON constraint_row.conindid = index_metadata.indexrelid
  WHERE table_namespace.nspname = 'public'
    AND index_relation.relname =
      'uq_license_request_requester_client_request';

  IF column_state.data_type IS DISTINCT FROM 'uuid'
    OR column_state.is_nullable IS DISTINCT FROM 'NO'
    OR column_state.column_default IS DISTINCT FROM 'gen_random_uuid()'
    OR index_state.index_name IS DISTINCT FROM
      'uq_license_request_requester_client_request'
    OR index_state.table_name IS DISTINCT FROM 'license_request'
    OR index_state.is_unique IS DISTINCT FROM true
    OR index_state.is_valid IS DISTINCT FROM true
    OR index_state.is_ready IS DISTINCT FROM true
    OR index_state.is_immediate IS DISTINCT FROM true
    OR index_state.key_count IS DISTINCT FROM 2
    OR index_state.attribute_count IS DISTINCT FROM 2
    OR index_state.access_method IS DISTINCT FROM 'btree'
    OR index_state.key_expressions IS DISTINCT FROM
      ARRAY['requested_by', 'client_request_id']::text[]
    OR index_state.predicate IS NOT NULL
    OR index_state.constraint_type IS DISTINCT FROM 'u'
    OR index_state.constraint_deferrable IS DISTINCT FROM false
    OR index_state.constraint_initially_deferred IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'uq_license_request_requester_client_request',
      MESSAGE = 'request-idempotency integrity mismatch';
  END IF;

  IF NOT has_table_privilege(
    'ledger_app',
    'public.license_request',
    'SELECT'
  ) OR NOT has_table_privilege(
    'ledger_app',
    'public.license_request',
    'INSERT'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE =
        'request-idempotency runtime privilege mismatch: license_request SELECT/INSERT';
  END IF;
END
$verification$;
