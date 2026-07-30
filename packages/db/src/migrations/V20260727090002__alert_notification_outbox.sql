-- US-042: AlertEvent is append-only (apart from acknowledgement), therefore
-- delivery state is an append-only journal rather than an AlertEvent update.
CREATE TYPE alert_notification_delivery_phase_enum AS ENUM (
  'pending', 'claimed', 'succeeded', 'failed'
);

CREATE TABLE alert_notification_delivery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  alert_event_id UUID NOT NULL REFERENCES alert_event(id),
  attempt INTEGER NOT NULL CHECK (attempt >= 0),
  phase alert_notification_delivery_phase_enum NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  lease_expires_at TIMESTAMPTZ,
  worker_id TEXT,
  provider_message_id TEXT,
  accepted JSONB,
  error_code TEXT,
  CONSTRAINT ck_alert_notification_delivery_shape CHECK (
    (phase = 'pending' AND attempt = 0
      AND lease_expires_at IS NULL AND worker_id IS NULL
      AND provider_message_id IS NULL AND accepted IS NULL AND error_code IS NULL)
    OR
    (phase = 'claimed' AND attempt > 0
      AND lease_expires_at IS NOT NULL AND worker_id IS NOT NULL
      AND provider_message_id IS NULL AND accepted IS NULL AND error_code IS NULL)
    OR
    (phase = 'succeeded' AND attempt > 0
      AND lease_expires_at IS NULL AND worker_id IS NOT NULL
      AND provider_message_id IS NOT NULL AND accepted IS NOT NULL AND error_code IS NULL)
    OR
    (phase = 'failed' AND attempt > 0
      AND lease_expires_at IS NULL AND worker_id IS NOT NULL
      AND provider_message_id IS NULL AND accepted IS NULL AND error_code IS NOT NULL)
  )
);

CREATE INDEX idx_alert_notification_delivery_alert_event_id
  ON alert_notification_delivery(alert_event_id);
CREATE UNIQUE INDEX uq_alert_notification_delivery_attempt_phase
  ON alert_notification_delivery(alert_event_id, attempt, phase);
CREATE UNIQUE INDEX uq_alert_notification_delivery_succeeded
  ON alert_notification_delivery(alert_event_id)
  WHERE phase = 'succeeded';

GRANT SELECT, INSERT ON alert_notification_delivery TO ledger_app;
REVOKE UPDATE, DELETE ON alert_notification_delivery FROM ledger_app;

CREATE OR REPLACE FUNCTION prevent_alert_notification_delivery_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'alert_notification_delivery is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trg_alert_notification_delivery_append_only
BEFORE UPDATE OR DELETE ON alert_notification_delivery
FOR EACH ROW EXECUTE FUNCTION prevent_alert_notification_delivery_mutation();
