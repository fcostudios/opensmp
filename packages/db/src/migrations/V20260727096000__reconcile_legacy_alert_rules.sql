-- US-042: repair pre-Sprint-2 semantic global rows before the historical
-- fixed-ID correction/verifier runs. AlertEvent references are transferred to
-- the canonical row; later verification governs semantics rather than IDs.
INSERT INTO alert_rule (
  id, type, scope_kind, threshold, channel, enabled, created_at, created_by
)
SELECT
  expected.id,
  expected.type::alert_rule_type_enum,
  'global',
  expected.threshold,
  'email',
  true,
  '2026-07-27T09:00:01Z',
  '00000000-0000-0000-0000-000000000001'
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
WHERE NOT EXISTS (
  SELECT 1
  FROM alert_rule actual
  WHERE actual.id = expected.id
);

WITH expected(id, type) AS (
  VALUES
    ('00000000-0000-4000-8000-000000004201'::uuid, 'approval_aging'),
    ('00000000-0000-4000-8000-000000004202'::uuid, 'provisioning_failure'),
    ('00000000-0000-4000-8000-000000004203'::uuid, 'blocked_no_seat'),
    ('00000000-0000-4000-8000-000000004204'::uuid, 'low_pool'),
    ('00000000-0000-4000-8000-000000004205'::uuid, 'invite_unaccepted'),
    ('00000000-0000-4000-8000-000000004206'::uuid, 'sync_stale'),
    ('00000000-0000-4000-8000-000000004207'::uuid, 'credential_failure'),
    ('00000000-0000-4000-8000-000000004208'::uuid, 'register_drift'),
    ('00000000-0000-4000-8000-000000004209'::uuid, 'deprovision_overdue'),
    ('00000000-0000-4000-8000-000000004210'::uuid, 'close_missed')
)
UPDATE alert_event event
SET alert_rule_id = expected.id
FROM alert_rule legacy
JOIN expected
  ON expected.type = legacy.type::text
WHERE event.alert_rule_id = legacy.id
  AND legacy.scope_kind = 'global'
  AND legacy.id <> expected.id;

WITH expected(id, type) AS (
  VALUES
    ('00000000-0000-4000-8000-000000004201'::uuid, 'approval_aging'),
    ('00000000-0000-4000-8000-000000004202'::uuid, 'provisioning_failure'),
    ('00000000-0000-4000-8000-000000004203'::uuid, 'blocked_no_seat'),
    ('00000000-0000-4000-8000-000000004204'::uuid, 'low_pool'),
    ('00000000-0000-4000-8000-000000004205'::uuid, 'invite_unaccepted'),
    ('00000000-0000-4000-8000-000000004206'::uuid, 'sync_stale'),
    ('00000000-0000-4000-8000-000000004207'::uuid, 'credential_failure'),
    ('00000000-0000-4000-8000-000000004208'::uuid, 'register_drift'),
    ('00000000-0000-4000-8000-000000004209'::uuid, 'deprovision_overdue'),
    ('00000000-0000-4000-8000-000000004210'::uuid, 'close_missed')
)
DELETE FROM alert_rule legacy
USING expected
WHERE legacy.type::text = expected.type
  AND legacy.scope_kind = 'global'
  AND legacy.id <> expected.id;

CREATE UNIQUE INDEX uq_alert_rule_global_type
  ON alert_rule(type)
  WHERE scope_kind = 'global';
