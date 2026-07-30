DO $request_number_immediacy_verification$
DECLARE
  constraint_state record;
BEGIN
  SELECT
    index_definition.indisunique AS is_unique,
    index_definition.indisvalid AS is_valid,
    index_definition.indisready AS is_ready,
    index_definition.indimmediate AS is_immediate,
    index_definition.indnkeyatts AS key_count,
    index_definition.indnatts AS attribute_count,
    access_method.amname AS access_method,
    ARRAY(
      SELECT pg_get_indexdef(
        index_definition.indexrelid,
        key_position,
        true
      )
      FROM generate_series(
        1,
        index_definition.indnkeyatts
      ) AS key_position
    ) AS key_expressions,
    pg_get_expr(
      index_definition.indpred,
      index_definition.indrelid,
      true
    ) AS predicate,
    constraint_row.contype AS constraint_type,
    constraint_row.conname AS constraint_name,
    constraint_row.convalidated AS is_constraint_valid,
    constraint_row.condeferrable AS is_deferrable,
    constraint_row.condeferred AS is_initially_deferred
  INTO constraint_state
  FROM pg_index AS index_definition
  JOIN pg_class AS index_relation
    ON index_relation.oid = index_definition.indexrelid
  JOIN pg_namespace AS index_namespace
    ON index_namespace.oid = index_relation.relnamespace
  JOIN pg_class AS table_relation
    ON table_relation.oid = index_definition.indrelid
  JOIN pg_namespace AS table_namespace
    ON table_namespace.oid = table_relation.relnamespace
  JOIN pg_am AS access_method
    ON access_method.oid = index_relation.relam
  LEFT JOIN pg_constraint AS constraint_row
    ON constraint_row.conindid = index_definition.indexrelid
  WHERE index_namespace.nspname = 'public'
    AND table_namespace.nspname = 'public'
    AND index_relation.relname = 'uq_license_request_request_no'
    AND table_relation.relname = 'license_request';

  IF NOT FOUND
    OR constraint_state.is_unique IS DISTINCT FROM true
    OR constraint_state.is_valid IS DISTINCT FROM true
    OR constraint_state.is_ready IS DISTINCT FROM true
    OR constraint_state.is_immediate IS DISTINCT FROM true
    OR constraint_state.key_count IS DISTINCT FROM 1
    OR constraint_state.attribute_count IS DISTINCT FROM 1
    OR constraint_state.access_method IS DISTINCT FROM 'btree'
    OR constraint_state.key_expressions
      IS DISTINCT FROM ARRAY['request_no']::text[]
    OR constraint_state.predicate IS NOT NULL
    OR constraint_state.constraint_type IS DISTINCT FROM 'u'
    OR constraint_state.constraint_name
      IS DISTINCT FROM 'uq_license_request_request_no'
    OR constraint_state.is_constraint_valid IS DISTINCT FROM true
    OR constraint_state.is_deferrable IS DISTINCT FROM false
    OR constraint_state.is_initially_deferred IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Sprint 2 request number verification failed: uq_license_request_request_no must be immediate';
  END IF;
END
$request_number_immediacy_verification$;
