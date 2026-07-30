-- US-017: approval-aging stages are one AlertEvent per pending-state breach,
-- with independently fenced recipient delivery streams under that event.
ALTER TABLE alert_notification_delivery
  ADD COLUMN recipient_key TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN recipient_user_account_id UUID REFERENCES user_account(id),
  ADD COLUMN recipient_email TEXT,
  ADD COLUMN recipient_locale user_account_ui_language_enum;

ALTER TABLE alert_notification_delivery
  ADD CONSTRAINT ck_alert_notification_delivery_recipient CHECK (
    btrim(recipient_key) <> ''
    AND (
      phase <> 'pending'
      OR recipient_email IS NULL
      OR btrim(recipient_email) <> ''
    )
  );

DROP INDEX uq_alert_notification_delivery_attempt_phase;
DROP INDEX uq_alert_notification_delivery_succeeded;
DROP INDEX idx_alert_notification_delivery_claim_fence;

CREATE UNIQUE INDEX uq_alert_notification_delivery_attempt_phase
  ON alert_notification_delivery(
    alert_event_id, recipient_key, attempt, phase
  );
CREATE UNIQUE INDEX uq_alert_notification_delivery_succeeded
  ON alert_notification_delivery(alert_event_id, recipient_key)
  WHERE phase = 'succeeded';
CREATE INDEX idx_alert_notification_delivery_claim_fence
  ON alert_notification_delivery(
    alert_event_id, recipient_key, attempt, claim_token
  );

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
        AND delivery.recipient_key = NEW.recipient_key
    ) THEN
      RAISE EXCEPTION 'alert recipient delivery already initialized'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.recipient_user_account_id IS NOT NULL
    OR NEW.recipient_email IS NOT NULL
    OR NEW.recipient_locale IS NOT NULL
  THEN
    RAISE EXCEPTION 'recipient snapshot belongs on pending delivery origin'
      USING ERRCODE = '55000';
  END IF;

  SELECT coalesce(max(delivery.attempt), 0)
  INTO latest_attempt
  FROM public.alert_notification_delivery delivery
  WHERE delivery.alert_event_id = NEW.alert_event_id
    AND delivery.recipient_key = NEW.recipient_key
    AND delivery.phase = 'claimed';

  IF NEW.phase = 'claimed' THEN
    IF NEW.claim_token IS NULL
      OR NEW.attempt <> latest_attempt + 1
      OR NOT EXISTS (
        SELECT 1
        FROM public.alert_notification_delivery delivery
        WHERE delivery.alert_event_id = NEW.alert_event_id
          AND delivery.recipient_key = NEW.recipient_key
          AND delivery.phase = 'pending'
      )
      OR EXISTS (
        SELECT 1
        FROM public.alert_notification_delivery delivery
        WHERE delivery.alert_event_id = NEW.alert_event_id
          AND delivery.recipient_key = NEW.recipient_key
          AND delivery.phase = 'succeeded'
      )
      OR EXISTS (
        SELECT 1
        FROM public.alert_notification_delivery delivery
        WHERE delivery.alert_event_id = NEW.alert_event_id
          AND delivery.recipient_key = NEW.recipient_key
          AND delivery.phase = 'claimed'
          AND delivery.lease_expires_at > NEW.occurred_at
          AND NOT EXISTS (
            SELECT 1
            FROM public.alert_notification_delivery terminal
            WHERE terminal.alert_event_id = delivery.alert_event_id
              AND terminal.recipient_key = delivery.recipient_key
              AND terminal.attempt = delivery.attempt
              AND terminal.phase IN ('succeeded', 'failed')
          )
      )
    THEN
      RAISE EXCEPTION 'invalid or unfenced alert recipient delivery claim'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  SELECT delivery.*
  INTO matching_claim
  FROM public.alert_notification_delivery delivery
  WHERE delivery.alert_event_id = NEW.alert_event_id
    AND delivery.recipient_key = NEW.recipient_key
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
        AND terminal.recipient_key = NEW.recipient_key
        AND terminal.attempt = NEW.attempt
        AND terminal.phase IN ('succeeded', 'failed')
    )
  THEN
    RAISE EXCEPTION 'invalid, expired, or stale alert recipient delivery fence'
      USING ERRCODE = '55000';
  END IF;

  NEW.worker_id := matching_claim.worker_id;
  RETURN NEW;
END;
$$;

CREATE FUNCTION append_alert_recipient_pending(
  p_alert_event_id uuid,
  p_recipient_key text,
  p_recipient_user_account_id uuid,
  p_recipient_email text,
  p_recipient_locale user_account_ui_language_enum,
  p_occurred_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'alert-delivery:' || p_alert_event_id::text || ':' || p_recipient_key, 0
    )
  );
  INSERT INTO public.alert_notification_delivery (
    alert_event_id, recipient_key, recipient_user_account_id,
    recipient_email, recipient_locale, attempt, phase, occurred_at
  ) VALUES (
    p_alert_event_id, p_recipient_key, p_recipient_user_account_id,
    p_recipient_email, p_recipient_locale, 0, 'pending', p_occurred_at
  );
END;
$$;

CREATE FUNCTION claim_alert_recipient_delivery(
  p_alert_event_id uuid,
  p_recipient_key text,
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
  IF p_lease_expires_at <= p_occurred_at
    OR btrim(p_worker_id) = ''
    OR btrim(p_recipient_key) = ''
  THEN
    RAISE EXCEPTION 'invalid alert recipient delivery claim input'
      USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'alert-delivery:' || p_alert_event_id::text || ':' || p_recipient_key, 0
    )
  );
  SELECT coalesce(max(delivery.attempt), 0) + 1
  INTO next_attempt
  FROM public.alert_notification_delivery delivery
  WHERE delivery.alert_event_id = p_alert_event_id
    AND delivery.recipient_key = p_recipient_key;
  next_token := pg_catalog.gen_random_uuid();

  INSERT INTO public.alert_notification_delivery (
    alert_event_id, recipient_key, attempt, phase, occurred_at,
    lease_expires_at, worker_id, claim_token
  ) VALUES (
    p_alert_event_id, p_recipient_key, next_attempt, 'claimed', p_occurred_at,
    p_lease_expires_at, p_worker_id, next_token
  );
  RETURN QUERY SELECT next_attempt, next_token;
END;
$$;

CREATE FUNCTION complete_alert_recipient_delivery(
  p_alert_event_id uuid,
  p_recipient_key text,
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
    RAISE EXCEPTION 'terminal alert recipient delivery phase required'
      USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'alert-delivery:' || p_alert_event_id::text || ':' || p_recipient_key, 0
    )
  );
  INSERT INTO public.alert_notification_delivery (
    alert_event_id, recipient_key, attempt, phase, occurred_at, claim_token,
    provider_message_id, accepted, error_code
  ) VALUES (
    p_alert_event_id, p_recipient_key, p_attempt, p_phase, p_occurred_at,
    p_claim_token, p_provider_message_id, p_accepted, p_error_code
  );
END;
$$;

REVOKE ALL ON FUNCTION append_alert_recipient_pending(
  uuid, text, uuid, text, user_account_ui_language_enum, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_alert_recipient_delivery(
  uuid, text, timestamptz, timestamptz, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_alert_recipient_delivery(
  uuid, text, integer, uuid, timestamptz,
  alert_notification_delivery_phase_enum, text, jsonb, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION append_alert_recipient_pending(
  uuid, text, uuid, text, user_account_ui_language_enum, timestamptz
) TO ledger_app;
GRANT EXECUTE ON FUNCTION claim_alert_recipient_delivery(
  uuid, text, timestamptz, timestamptz, text
) TO ledger_app;
GRANT EXECUTE ON FUNCTION complete_alert_recipient_delivery(
  uuid, text, integer, uuid, timestamptz,
  alert_notification_delivery_phase_enum, text, jsonb, text
) TO ledger_app;

-- Reconcile only the canonical legacy default. Custom or malformed rules stay
-- untouched so runtime validation fails closed instead of inventing policy.
UPDATE alert_rule
SET threshold = '{"hours":24,"escalationHours":48}'::jsonb
WHERE type = 'approval_aging'
  AND threshold = '{"hours":24}'::jsonb;
