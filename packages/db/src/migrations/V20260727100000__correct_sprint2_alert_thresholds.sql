-- US-042: align deterministic Sprint 2 defaults with the authoritative stories.
UPDATE alert_rule
SET threshold = corrections.threshold
FROM (
  VALUES
    ('00000000-0000-4000-8000-000000004203'::uuid, '{"businessDays":1}'::jsonb),
    ('00000000-0000-4000-8000-000000004204'::uuid, '{"floor":5}'::jsonb),
    ('00000000-0000-4000-8000-000000004205'::uuid, '{"hours":168}'::jsonb),
    ('00000000-0000-4000-8000-000000004206'::uuid, '{"hours":48}'::jsonb),
    ('00000000-0000-4000-8000-000000004210'::uuid, '{"businessDays":3}'::jsonb)
) AS corrections(id, threshold)
WHERE alert_rule.id = corrections.id
  AND alert_rule.scope_kind = 'global';
