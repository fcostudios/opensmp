-- US-042: journal writes are a privileged state machine. ledger_app may invoke
-- narrow transition functions but cannot forge rows with direct INSERT.
ALTER TABLE alert_notification_delivery
  ADD COLUMN claim_token UUID;

-- Existing in-flight journal rows predate fencing. Backfill one opaque token per
-- event/attempt while the owner performs this controlled release migration.
ALTER TABLE alert_notification_delivery
  DISABLE TRIGGER trg_alert_notification_delivery_append_only;
WITH fences AS (
  SELECT
    alert_event_id,
    attempt,
    gen_random_uuid() AS claim_token
  FROM alert_notification_delivery
  WHERE phase IN ('claimed', 'succeeded', 'failed')
  GROUP BY alert_event_id, attempt
)
UPDATE alert_notification_delivery delivery
SET claim_token = fences.claim_token
FROM fences
WHERE delivery.alert_event_id = fences.alert_event_id
  AND delivery.attempt = fences.attempt
  AND delivery.phase IN ('claimed', 'succeeded', 'failed');
ALTER TABLE alert_notification_delivery
  ENABLE TRIGGER trg_alert_notification_delivery_append_only;

ALTER TABLE alert_notification_delivery
  ADD CONSTRAINT ck_alert_notification_delivery_claim_fence CHECK (
    (phase = 'pending' AND claim_token IS NULL)
    OR
    (phase IN ('claimed', 'succeeded', 'failed') AND claim_token IS NOT NULL)
  );

CREATE INDEX idx_alert_notification_delivery_claim_fence
  ON alert_notification_delivery(alert_event_id, attempt, claim_token);

REVOKE INSERT ON alert_notification_delivery FROM ledger_app;

CREATE OR REPLACE FUNCTION validate_alert_delivery_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  latest_attempt integer;
  matching_claim public.alert_notification_delivery%ROWTYPE;
BEGIN
  IF NEW.phase = 'pending' THEN
    IF EXISTS (
      SELECT 1
      FROM public.alert_notification_delivery delivery
      WHERE delivery.alert_event_id = NEW.alert_event_id
    ) THEN
      RAISE EXCEPTION 'alert delivery already initialized'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  SELECT coalesce(max(delivery.attempt), 0)
  INTO latest_attempt
  FROM public.alert_notification_delivery delivery
  WHERE delivery.alert_event_id = NEW.alert_event_id
    AND delivery.phase = 'claimed';

  IF NEW.phase = 'claimed' THEN
    IF NEW.claim_token IS NULL
      OR NEW.attempt <> latest_attempt + 1
      OR NOT EXISTS (
        SELECT 1
        FROM public.alert_notification_delivery delivery
        WHERE delivery.alert_event_id = NEW.alert_event_id
          AND delivery.phase = 'pending'
      )
      OR EXISTS (
        SELECT 1
        FROM public.alert_notification_delivery delivery
        WHERE delivery.alert_event_id = NEW.alert_event_id
          AND delivery.phase = 'succeeded'
      )
      OR EXISTS (
        SELECT 1
        FROM public.alert_notification_delivery delivery
        WHERE delivery.alert_event_id = NEW.alert_event_id
          AND delivery.phase = 'claimed'
          AND delivery.lease_expires_at > NEW.occurred_at
          AND NOT EXISTS (
            SELECT 1
            FROM public.alert_notification_delivery terminal
            WHERE terminal.alert_event_id = delivery.alert_event_id
              AND terminal.attempt = delivery.attempt
              AND terminal.phase IN ('succeeded', 'failed')
          )
      )
    THEN
      RAISE EXCEPTION 'invalid or unfenced alert delivery claim'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  SELECT delivery.*
  INTO matching_claim
  FROM public.alert_notification_delivery delivery
  WHERE delivery.alert_event_id = NEW.alert_event_id
    AND delivery.phase = 'claimed'
    AND delivery.attempt = NEW.attempt
    AND delivery.claim_token = NEW.claim_token;

  IF NOT FOUND
    OR NEW.claim_token IS NULL
    OR NEW.attempt <> latest_attempt
    OR matching_claim.lease_expires_at <= NEW.occurred_at
    OR EXISTS (
      SELECT 1
      FROM public.alert_notification_delivery terminal
      WHERE terminal.alert_event_id = NEW.alert_event_id
        AND terminal.attempt = NEW.attempt
        AND terminal.phase IN ('succeeded', 'failed')
    )
  THEN
    RAISE EXCEPTION 'invalid, expired, or stale alert delivery fence'
      USING ERRCODE = '55000';
  END IF;

  NEW.worker_id := matching_claim.worker_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_alert_notification_delivery_validate_insert
BEFORE INSERT ON alert_notification_delivery
FOR EACH ROW EXECUTE FUNCTION validate_alert_delivery_insert();

REVOKE ALL ON FUNCTION validate_alert_delivery_insert() FROM PUBLIC;

CREATE OR REPLACE FUNCTION append_alert_delivery_pending(
  p_alert_event_id uuid,
  p_occurred_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('alert-delivery:' || p_alert_event_id::text, 0)
  );
  INSERT INTO public.alert_notification_delivery (
    alert_event_id, attempt, phase, occurred_at
  ) VALUES (
    p_alert_event_id, 0, 'pending', p_occurred_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION claim_alert_delivery(
  p_alert_event_id uuid,
  p_occurred_at timestamptz,
  p_lease_expires_at timestamptz,
  p_worker_id text
)
RETURNS TABLE(attempt integer, claim_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  next_attempt integer;
  next_token uuid;
BEGIN
  IF p_lease_expires_at <= p_occurred_at OR btrim(p_worker_id) = '' THEN
    RAISE EXCEPTION 'invalid alert delivery claim input'
      USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('alert-delivery:' || p_alert_event_id::text, 0)
  );
  SELECT coalesce(max(delivery.attempt), 0) + 1
  INTO next_attempt
  FROM public.alert_notification_delivery delivery
  WHERE delivery.alert_event_id = p_alert_event_id;
  next_token := pg_catalog.gen_random_uuid();

  INSERT INTO public.alert_notification_delivery (
    alert_event_id, attempt, phase, occurred_at, lease_expires_at, worker_id,
    claim_token
  ) VALUES (
    p_alert_event_id, next_attempt, 'claimed', p_occurred_at,
    p_lease_expires_at, p_worker_id, next_token
  );
  RETURN QUERY SELECT next_attempt, next_token;
END;
$$;

CREATE OR REPLACE FUNCTION complete_alert_delivery(
  p_alert_event_id uuid,
  p_attempt integer,
  p_claim_token uuid,
  p_occurred_at timestamptz,
  p_phase alert_notification_delivery_phase_enum,
  p_provider_message_id text,
  p_accepted jsonb,
  p_error_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_phase NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'terminal alert delivery phase required'
      USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('alert-delivery:' || p_alert_event_id::text, 0)
  );
  INSERT INTO public.alert_notification_delivery (
    alert_event_id, attempt, phase, occurred_at, claim_token,
    provider_message_id, accepted, error_code
  ) VALUES (
    p_alert_event_id, p_attempt, p_phase, p_occurred_at, p_claim_token,
    p_provider_message_id, p_accepted, p_error_code
  );
END;
$$;

REVOKE ALL ON FUNCTION append_alert_delivery_pending(uuid, timestamptz)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_alert_delivery(uuid, timestamptz, timestamptz, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_alert_delivery(
  uuid, integer, uuid, timestamptz, alert_notification_delivery_phase_enum,
  text, jsonb, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION append_alert_delivery_pending(uuid, timestamptz)
  TO ledger_app;
GRANT EXECUTE ON FUNCTION claim_alert_delivery(uuid, timestamptz, timestamptz, text)
  TO ledger_app;
GRANT EXECUTE ON FUNCTION complete_alert_delivery(
  uuid, integer, uuid, timestamptz, alert_notification_delivery_phase_enum,
  text, jsonb, text
) TO ledger_app;
