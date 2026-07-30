DO $sprint2_workflow_guard_verification$
DECLARE
  actual_enum_labels text[];
  column_state record;
  index_state record;
BEGIN
  SELECT array_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder)
  INTO actual_enum_labels
  FROM pg_type AS enum_type
  JOIN pg_namespace AS namespace
    ON namespace.oid = enum_type.typnamespace
  JOIN pg_enum AS enum_value
    ON enum_value.enumtypid = enum_type.oid
  WHERE namespace.nspname = 'public'
    AND enum_type.typname = 'alert_rule_type_enum';

  IF actual_enum_labels IS DISTINCT FROM ARRAY[
    'approval_aging',
    'provisioning_failure',
    'blocked_no_seat',
    'low_pool',
    'invite_unaccepted',
    'sync_stale',
    'credential_failure',
    'register_drift',
    'deprovision_overdue',
    'close_missed'
  ]::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Sprint 2 workflow guard verification failed: alert_rule_type_enum labels/order';
  END IF;

  SELECT
    format_type(attribute.atttypid, attribute.atttypmod) AS normalized_type,
    NOT attribute.attnotnull AS nullable,
    attribute.atthasdef AS has_default,
    attribute.attidentity AS identity_kind,
    attribute.attgenerated AS generated_kind
  INTO column_state
  FROM pg_attribute AS attribute
  JOIN pg_class AS relation
    ON relation.oid = attribute.attrelid
  JOIN pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname = 'alert_event'
    AND relation.relkind IN ('r', 'p')
    AND attribute.attname = 'dedupe_key'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF NOT FOUND
    OR column_state.normalized_type IS DISTINCT FROM 'text'
    OR column_state.nullable IS DISTINCT FROM true
    OR column_state.has_default IS DISTINCT FROM false
    OR column_state.identity_kind IS DISTINCT FROM ''
    OR column_state.generated_kind IS DISTINCT FROM ''
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Sprint 2 workflow guard verification failed: alert_event.dedupe_key column';
  END IF;

  SELECT
    index_definition.indisunique AS is_unique,
    index_definition.indisvalid AS is_valid,
    index_definition.indisready AS is_ready,
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
    constraint_row.contype AS constraint_type
  INTO index_state
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
    AND index_relation.relname = 'uq_alert_event_dedupe_key'
    AND table_relation.relname = 'alert_event';

  IF NOT FOUND
    OR index_state.is_unique IS DISTINCT FROM true
    OR index_state.is_valid IS DISTINCT FROM true
    OR index_state.is_ready IS DISTINCT FROM true
    OR index_state.key_count IS DISTINCT FROM 1
    OR index_state.attribute_count IS DISTINCT FROM 1
    OR index_state.access_method IS DISTINCT FROM 'btree'
    OR index_state.key_expressions IS DISTINCT FROM ARRAY['dedupe_key']::text[]
    OR index_state.predicate IS DISTINCT FROM 'dedupe_key IS NOT NULL'
    OR index_state.constraint_type IS NOT NULL
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Sprint 2 workflow guard verification failed: uq_alert_event_dedupe_key index';
  END IF;

  SELECT
    index_definition.indisunique AS is_unique,
    index_definition.indisvalid AS is_valid,
    index_definition.indisready AS is_ready,
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
    constraint_row.contype AS constraint_type
  INTO index_state
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
    AND index_relation.relname = 'uq_person_lower_email'
    AND table_relation.relname = 'person';

  IF NOT FOUND
    OR index_state.is_unique IS DISTINCT FROM true
    OR index_state.is_valid IS DISTINCT FROM true
    OR index_state.is_ready IS DISTINCT FROM true
    OR index_state.key_count IS DISTINCT FROM 1
    OR index_state.attribute_count IS DISTINCT FROM 1
    OR index_state.access_method IS DISTINCT FROM 'btree'
    OR index_state.key_expressions IS DISTINCT FROM ARRAY['lower(email)']::text[]
    OR index_state.predicate IS NOT NULL
    OR index_state.constraint_type IS NOT NULL
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Sprint 2 workflow guard verification failed: uq_person_lower_email index';
  END IF;

  SELECT
    index_definition.indisunique AS is_unique,
    index_definition.indisvalid AS is_valid,
    index_definition.indisready AS is_ready,
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
    constraint_row.conname AS constraint_name
  INTO index_state
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
    OR index_state.is_unique IS DISTINCT FROM true
    OR index_state.is_valid IS DISTINCT FROM true
    OR index_state.is_ready IS DISTINCT FROM true
    OR index_state.key_count IS DISTINCT FROM 1
    OR index_state.attribute_count IS DISTINCT FROM 1
    OR index_state.access_method IS DISTINCT FROM 'btree'
    OR index_state.key_expressions IS DISTINCT FROM ARRAY['request_no']::text[]
    OR index_state.predicate IS NOT NULL
    OR index_state.constraint_type IS DISTINCT FROM 'u'
    OR index_state.constraint_name IS DISTINCT FROM 'uq_license_request_request_no'
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Sprint 2 workflow guard verification failed: uq_license_request_request_no constraint';
  END IF;
END
$sprint2_workflow_guard_verification$;
