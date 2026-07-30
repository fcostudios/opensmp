-- US-042/US-024 AC4: deprovisioning is due by the end of the same
-- Ecuador business day, not after a rolling 24-hour interval.
UPDATE alert_rule
SET threshold = '{"businessDays":0}'::jsonb
WHERE type = 'deprovision_overdue'
  AND threshold IS DISTINCT FROM '{"businessDays":0}'::jsonb;
