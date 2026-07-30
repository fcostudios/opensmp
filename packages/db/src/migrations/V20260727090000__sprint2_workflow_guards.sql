ALTER TYPE alert_rule_type_enum
  ADD VALUE IF NOT EXISTS 'deprovision_overdue';

ALTER TYPE alert_rule_type_enum
  ADD VALUE IF NOT EXISTS 'close_missed';

ALTER TABLE alert_event
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_event_dedupe_key
  ON alert_event (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_person_lower_email
  ON person (lower(email));
