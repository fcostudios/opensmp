-- US-042: deterministic, idempotent defaults for every P0 alert type.
INSERT INTO alert_rule (
  id, type, scope_kind, threshold, channel, enabled, created_at, created_by
)
SELECT seed.id, seed.type::alert_rule_type_enum, 'global', seed.threshold,
       'email', true, '2026-07-27T09:00:01Z',
       '00000000-0000-0000-0000-000000000001'
FROM (
  VALUES
    ('00000000-0000-4000-8000-000000004201'::uuid, 'approval_aging',       '{"hours":24}'::jsonb),
    ('00000000-0000-4000-8000-000000004202'::uuid, 'provisioning_failure', '{"failures":1}'::jsonb),
    ('00000000-0000-4000-8000-000000004203'::uuid, 'blocked_no_seat',      '{"minutes":15}'::jsonb),
    ('00000000-0000-4000-8000-000000004204'::uuid, 'low_pool',             '{"floor":2}'::jsonb),
    ('00000000-0000-4000-8000-000000004205'::uuid, 'invite_unaccepted',    '{"hours":48}'::jsonb),
    ('00000000-0000-4000-8000-000000004206'::uuid, 'sync_stale',           '{"minutes":30}'::jsonb),
    ('00000000-0000-4000-8000-000000004207'::uuid, 'credential_failure',   '{"failures":1}'::jsonb),
    ('00000000-0000-4000-8000-000000004208'::uuid, 'register_drift',       '{"mismatches":1}'::jsonb),
    ('00000000-0000-4000-8000-000000004209'::uuid, 'deprovision_overdue',  '{"hours":24}'::jsonb),
    ('00000000-0000-4000-8000-000000004210'::uuid, 'close_missed',         '{"misses":1}'::jsonb)
) AS seed(id, type, threshold)
WHERE NOT EXISTS (
  SELECT 1
  FROM alert_rule existing
  WHERE existing.type = seed.type::alert_rule_type_enum
    AND existing.scope_kind = 'global'
);
