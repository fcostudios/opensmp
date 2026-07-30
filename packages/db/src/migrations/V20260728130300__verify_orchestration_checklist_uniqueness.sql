DO $orchestration_checklist_uniqueness_verification$
DECLARE
  index_state record;
BEGIN
  SELECT
    definition.indisunique AS is_unique,
    definition.indisvalid AS is_valid,
    definition.indisready AS is_ready,
    definition.indnkeyatts AS key_count,
    definition.indnatts AS attribute_count,
    ARRAY(
      SELECT pg_get_indexdef(definition.indexrelid, key_position, true)
      FROM generate_series(1, definition.indnkeyatts) AS key_position
      ORDER BY key_position
    ) AS key_expressions,
    regexp_replace(
      lower(pg_get_expr(definition.indpred, definition.indrelid, true)),
      '[[:space:]()]',
      '',
      'g'
    ) AS normalized_predicate
  INTO index_state
  FROM pg_index AS definition
  JOIN pg_class AS relation ON relation.oid = definition.indexrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname =
      'uq_provisioning_action_orchestration_checklist_operation';

  IF NOT FOUND
    OR index_state.is_unique IS DISTINCT FROM true
    OR index_state.is_valid IS DISTINCT FROM true
    OR index_state.is_ready IS DISTINCT FROM true
    OR index_state.key_count IS DISTINCT FROM 2
    OR index_state.attribute_count IS DISTINCT FROM 2
    OR index_state.key_expressions IS DISTINCT FROM
      ARRAY['request_id', '(raw_request ->> ''operation''::text)']::text[]
    OR index_state.normalized_predicate IS DISTINCT FROM
      'kind=''checklist''::provisioning_action_kind_enumandmode=''orchestration''::provisioning_action_mode_enumandraw_request->>''operation''::text=anyarray[''provision''::text,''deprovision''::text]'
  THEN
    RAISE EXCEPTION
      'Orchestration checklist uniqueness verifier failed: exact request/operation index: %',
      row_to_json(index_state);
  END IF;

  IF to_regclass(
    'public.uq_provisioning_action_orchestration_checklist_request'
  ) IS NOT NULL THEN
    RAISE EXCEPTION
      'Orchestration checklist uniqueness verifier failed: legacy request-only index remains';
  END IF;
END
$orchestration_checklist_uniqueness_verification$;
