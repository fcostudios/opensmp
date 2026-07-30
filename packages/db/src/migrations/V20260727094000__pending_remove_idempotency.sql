CREATE UNIQUE INDEX uq_provisioning_action_pending_remove_request
  ON provisioning_action (request_id)
  WHERE kind = 'remove' AND status = 'pending';

DO $pending_remove_idempotency_verification$
DECLARE
  index_state record;
BEGIN
  SELECT
    definition.indisunique AS is_unique,
    definition.indisvalid AS is_valid,
    definition.indisready AS is_ready,
    pg_get_expr(definition.indpred, definition.indrelid, true) AS predicate
  INTO index_state
  FROM pg_index AS definition
  JOIN pg_class AS relation ON relation.oid = definition.indexrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname =
      'uq_provisioning_action_pending_remove_request';

  IF NOT FOUND
    OR index_state.is_unique IS DISTINCT FROM true
    OR index_state.is_valid IS DISTINCT FROM true
    OR index_state.is_ready IS DISTINCT FROM true
    OR index_state.predicate IS DISTINCT FROM
      'kind = ''remove''::provisioning_action_kind_enum AND status = ''pending''::provisioning_action_status_enum'
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Pending remove idempotency index verification failed';
  END IF;
END
$pending_remove_idempotency_verification$;
