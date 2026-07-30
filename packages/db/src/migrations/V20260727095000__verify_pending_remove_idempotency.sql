DO $pending_remove_idempotency_verifier$
DECLARE
  index_state record;
BEGIN
  SELECT
    table_relation.relname AS table_name,
    access_method.amname AS access_method,
    definition.indisunique AS is_unique,
    definition.indisvalid AS is_valid,
    definition.indisready AS is_ready,
    definition.indimmediate AS is_immediate,
    definition.indnkeyatts AS key_count,
    definition.indnatts AS attribute_count,
    ARRAY(
      SELECT pg_get_indexdef(
        definition.indexrelid,
        key_position,
        true
      )
      FROM generate_series(
        1,
        definition.indnkeyatts
      ) AS key_position
    ) AS key_expressions,
    regexp_replace(
      regexp_replace(
        lower(pg_get_expr(definition.indpred, definition.indrelid, true)),
        '::[a-z_][a-z0-9_]*',
        '',
        'g'
      ),
      '[[:space:]()]',
      '',
      'g'
    ) AS normalized_predicate,
    constraint_row.contype AS constraint_type,
    constraint_row.condeferrable AS constraint_deferrable,
    constraint_row.condeferred AS constraint_initially_deferred
  INTO index_state
  FROM pg_index AS definition
  JOIN pg_class AS index_relation
    ON index_relation.oid = definition.indexrelid
  JOIN pg_namespace AS index_namespace
    ON index_namespace.oid = index_relation.relnamespace
  JOIN pg_class AS table_relation
    ON table_relation.oid = definition.indrelid
  JOIN pg_namespace AS table_namespace
    ON table_namespace.oid = table_relation.relnamespace
  JOIN pg_am AS access_method
    ON access_method.oid = index_relation.relam
  LEFT JOIN pg_constraint AS constraint_row
    ON constraint_row.conindid = definition.indexrelid
  WHERE index_namespace.nspname = 'public'
    AND table_namespace.nspname = 'public'
    AND index_relation.relname =
      'uq_provisioning_action_pending_remove_request';

  IF NOT FOUND
    OR index_state.table_name IS DISTINCT FROM 'provisioning_action'
    OR index_state.access_method IS DISTINCT FROM 'btree'
    OR index_state.is_unique IS DISTINCT FROM true
    OR index_state.is_valid IS DISTINCT FROM true
    OR index_state.is_ready IS DISTINCT FROM true
    OR index_state.is_immediate IS DISTINCT FROM true
    OR index_state.key_count IS DISTINCT FROM 1
    OR index_state.attribute_count IS DISTINCT FROM 1
    OR index_state.key_expressions IS DISTINCT FROM ARRAY['request_id']::text[]
    OR index_state.normalized_predicate IS DISTINCT FROM
      'kind=''remove''andstatus=''pending'''
    OR index_state.constraint_type IS NOT NULL
    OR index_state.constraint_deferrable IS NOT NULL
    OR index_state.constraint_initially_deferred IS NOT NULL
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'uq_provisioning_action_pending_remove_request',
      MESSAGE =
        'Pending remove idempotency verifier failed: uq_provisioning_action_pending_remove_request exact index';
  END IF;
END
$pending_remove_idempotency_verifier$;
