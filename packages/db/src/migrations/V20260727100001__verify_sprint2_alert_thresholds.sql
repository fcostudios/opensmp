-- US-042: fail release when the deterministic alert defaults drift.
DO $$
DECLARE
  mismatches integer;
BEGIN
  SELECT count(*)::integer
  INTO mismatches
  FROM (
    VALUES
      ('00000000-0000-4000-8000-000000004201'::uuid, 'approval_aging',       '{"hours":24}'::jsonb),
      ('00000000-0000-4000-8000-000000004202'::uuid, 'provisioning_failure', '{"failures":1}'::jsonb),
      ('00000000-0000-4000-8000-000000004203'::uuid, 'blocked_no_seat',      '{"businessDays":1}'::jsonb),
      ('00000000-0000-4000-8000-000000004204'::uuid, 'low_pool',             '{"floor":5}'::jsonb),
      ('00000000-0000-4000-8000-000000004205'::uuid, 'invite_unaccepted',    '{"hours":168}'::jsonb),
      ('00000000-0000-4000-8000-000000004206'::uuid, 'sync_stale',           '{"hours":48}'::jsonb),
      ('00000000-0000-4000-8000-000000004207'::uuid, 'credential_failure',   '{"failures":1}'::jsonb),
      ('00000000-0000-4000-8000-000000004208'::uuid, 'register_drift',       '{"mismatches":1}'::jsonb),
      ('00000000-0000-4000-8000-000000004209'::uuid, 'deprovision_overdue',  '{"hours":24}'::jsonb),
      ('00000000-0000-4000-8000-000000004210'::uuid, 'close_missed',         '{"businessDays":3}'::jsonb)
  ) AS expected(id, type, threshold)
  LEFT JOIN alert_rule actual ON actual.id = expected.id
  WHERE actual.id IS NULL
     OR actual.type::text <> expected.type
     OR actual.scope_kind <> 'global'
     OR actual.threshold IS DISTINCT FROM expected.threshold
     OR actual.channel <> 'email'
     OR actual.enabled IS NOT TRUE
     OR actual.created_by <> '00000000-0000-0000-0000-000000000001'::uuid;

  IF mismatches <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'Sprint 2 alert threshold verification failed';
  END IF;
END
$$;
