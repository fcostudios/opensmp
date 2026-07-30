-- US-042: global defaults are governed by semantics, never bootstrap IDs.
DO $$
DECLARE
  mismatch_count integer;
BEGIN
  SELECT count(*)::integer
  INTO mismatch_count
  FROM (
    VALUES
      ('approval_aging',       '{"hours":24}'::jsonb),
      ('provisioning_failure', '{"failures":1}'::jsonb),
      ('blocked_no_seat',      '{"businessDays":1}'::jsonb),
      ('low_pool',             '{"floor":5}'::jsonb),
      ('invite_unaccepted',    '{"hours":168}'::jsonb),
      ('sync_stale',           '{"hours":48}'::jsonb),
      ('credential_failure',   '{"failures":1}'::jsonb),
      ('register_drift',       '{"mismatches":1}'::jsonb),
      ('deprovision_overdue',  '{"hours":24}'::jsonb),
      ('close_missed',         '{"businessDays":3}'::jsonb)
  ) AS expected(type, threshold)
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS rule_count,
      bool_and(actual.threshold IS NOT DISTINCT FROM expected.threshold) AS threshold_matches,
      bool_and(actual.channel = 'email') AS channel_matches,
      bool_and(actual.enabled) AS enabled
    FROM alert_rule actual
    WHERE actual.type = expected.type::alert_rule_type_enum
      AND actual.scope_kind = 'global'
  ) actual ON true
  WHERE actual.rule_count <> 1
     OR actual.threshold_matches IS DISTINCT FROM true
     OR actual.channel_matches IS DISTINCT FROM true
     OR actual.enabled IS DISTINCT FROM true;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'alert_rule_global_semantic_defaults',
      MESSAGE = 'Sprint 2 semantic alert default verification failed';
  END IF;
END
$$;
