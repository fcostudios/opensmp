-- US-016: durable lifecycle email work is committed atomically with the
-- business transition; SMTP delivery is claimed only after that commit.
CREATE TYPE lifecycle_notification_kind_enum AS ENUM (
  'submission',
  'new_request_to_approver',
  'decision',
  'provisioning_complete'
);

CREATE TABLE lifecycle_notification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  request_id UUID NOT NULL REFERENCES license_request(id),
  company_id UUID NOT NULL REFERENCES company(id),
  kind lifecycle_notification_kind_enum NOT NULL,
  recipient_user_account_id UUID REFERENCES user_account(id),
  recipient_email TEXT NOT NULL CHECK (btrim(recipient_email) <> ''),
  recipient_locale user_account_ui_language_enum,
  request_state license_request_state_enum NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_lifecycle_notification_request
  ON lifecycle_notification(request_id, created_at, id);

CREATE TABLE lifecycle_notification_delivery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  notification_id UUID NOT NULL REFERENCES lifecycle_notification(id),
  attempt INTEGER NOT NULL CHECK (attempt >= 0),
  phase alert_notification_delivery_phase_enum NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  lease_expires_at TIMESTAMPTZ,
  worker_id TEXT,
  provider_message_id TEXT,
  accepted JSONB,
  error_code TEXT,
  claim_token UUID,
  CONSTRAINT ck_lifecycle_notification_delivery_shape CHECK (
    (phase = 'pending' AND attempt = 0 AND claim_token IS NULL
      AND lease_expires_at IS NULL AND worker_id IS NULL
      AND provider_message_id IS NULL AND accepted IS NULL AND error_code IS NULL)
    OR
    (phase = 'claimed' AND attempt > 0 AND claim_token IS NOT NULL
      AND lease_expires_at IS NOT NULL AND btrim(worker_id) <> ''
      AND provider_message_id IS NULL AND accepted IS NULL AND error_code IS NULL)
    OR
    (phase = 'succeeded' AND attempt > 0 AND claim_token IS NOT NULL
      AND lease_expires_at IS NULL AND btrim(worker_id) <> ''
      AND provider_message_id IS NOT NULL AND accepted IS NOT NULL
      AND error_code IS NULL)
    OR
    (phase = 'failed' AND attempt > 0 AND claim_token IS NOT NULL
      AND lease_expires_at IS NULL AND btrim(worker_id) <> ''
      AND provider_message_id IS NULL AND accepted IS NULL
      AND btrim(error_code) <> '')
  )
);

CREATE UNIQUE INDEX uq_lifecycle_notification_delivery_attempt_phase
  ON lifecycle_notification_delivery(notification_id, attempt, phase);
CREATE UNIQUE INDEX uq_lifecycle_notification_delivery_succeeded
  ON lifecycle_notification_delivery(notification_id)
  WHERE phase = 'succeeded';
CREATE INDEX idx_lifecycle_notification_delivery_claim
  ON lifecycle_notification_delivery(notification_id, attempt, claim_token);

CREATE OR REPLACE FUNCTION prevent_lifecycle_notification_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lifecycle notification records are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trg_lifecycle_notification_append_only
BEFORE UPDATE OR DELETE ON lifecycle_notification
FOR EACH ROW EXECUTE FUNCTION prevent_lifecycle_notification_mutation();

CREATE TRIGGER trg_lifecycle_notification_delivery_append_only
BEFORE UPDATE OR DELETE ON lifecycle_notification_delivery
FOR EACH ROW EXECUTE FUNCTION prevent_lifecycle_notification_mutation();

REVOKE ALL ON FUNCTION prevent_lifecycle_notification_mutation() FROM PUBLIC;

CREATE OR REPLACE FUNCTION initialize_lifecycle_notification_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.lifecycle_notification_delivery
    (notification_id, attempt, phase, occurred_at)
  VALUES (NEW.id, 0, 'pending', NEW.created_at);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lifecycle_notification_initialize_delivery
AFTER INSERT ON lifecycle_notification
FOR EACH ROW EXECUTE FUNCTION initialize_lifecycle_notification_delivery();

CREATE OR REPLACE FUNCTION claim_lifecycle_notification(
  p_notification_id uuid,
  p_occurred_at timestamptz,
  p_lease_expires_at timestamptz,
  p_worker_id text
)
RETURNS TABLE(status text, attempt integer, claim_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  next_attempt integer;
  next_token uuid;
BEGIN
  IF p_lease_expires_at <= p_occurred_at OR btrim(p_worker_id) = '' THEN
    RAISE EXCEPTION 'invalid lifecycle notification claim input'
      USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'lifecycle-notification:' || p_notification_id::text, 0
    )
  );
  IF EXISTS (
    SELECT 1 FROM public.lifecycle_notification_delivery
    WHERE notification_id = p_notification_id AND phase = 'succeeded'
  ) THEN
    RETURN QUERY SELECT 'already_succeeded'::text, NULL::integer, NULL::uuid;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.lifecycle_notification_delivery claim
    WHERE claim.notification_id = p_notification_id
      AND claim.phase = 'claimed'
      AND claim.lease_expires_at > p_occurred_at
      AND NOT EXISTS (
        SELECT 1 FROM public.lifecycle_notification_delivery terminal
        WHERE terminal.notification_id = claim.notification_id
          AND terminal.attempt = claim.attempt
          AND terminal.phase IN ('succeeded', 'failed')
      )
  ) THEN
    RETURN QUERY SELECT 'busy'::text, NULL::integer, NULL::uuid;
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.lifecycle_notification_delivery
    WHERE notification_id = p_notification_id AND phase = 'pending'
  ) THEN
    RAISE EXCEPTION 'lifecycle notification is not initialized'
      USING ERRCODE = '55000';
  END IF;
  SELECT coalesce(max(delivery.attempt), 0) + 1
  INTO next_attempt
  FROM public.lifecycle_notification_delivery delivery
  WHERE delivery.notification_id = p_notification_id;
  next_token := pg_catalog.gen_random_uuid();
  INSERT INTO public.lifecycle_notification_delivery (
    notification_id, attempt, phase, occurred_at, lease_expires_at,
    worker_id, claim_token
  ) VALUES (
    p_notification_id, next_attempt, 'claimed', p_occurred_at,
    p_lease_expires_at, p_worker_id, next_token
  );
  RETURN QUERY SELECT 'claimed'::text, next_attempt, next_token;
END;
$$;

CREATE OR REPLACE FUNCTION complete_lifecycle_notification(
  p_notification_id uuid,
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
DECLARE
  claim public.lifecycle_notification_delivery%ROWTYPE;
BEGIN
  IF p_phase NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'terminal lifecycle notification phase required'
      USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'lifecycle-notification:' || p_notification_id::text, 0
    )
  );
  SELECT delivery.* INTO claim
  FROM public.lifecycle_notification_delivery delivery
  WHERE delivery.notification_id = p_notification_id
    AND delivery.phase = 'claimed'
    AND delivery.attempt = p_attempt
    AND delivery.claim_token = p_claim_token;
  IF NOT FOUND
    OR claim.lease_expires_at <= p_occurred_at
    OR EXISTS (
      SELECT 1 FROM public.lifecycle_notification_delivery terminal
      WHERE terminal.notification_id = p_notification_id
        AND terminal.attempt = p_attempt
        AND terminal.phase IN ('succeeded', 'failed')
    )
  THEN
    RAISE EXCEPTION 'invalid, expired, or stale lifecycle delivery fence'
      USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.lifecycle_notification_delivery (
    notification_id, attempt, phase, occurred_at, worker_id, claim_token,
    provider_message_id, accepted, error_code
  ) VALUES (
    p_notification_id, p_attempt, p_phase, p_occurred_at, claim.worker_id,
    p_claim_token, p_provider_message_id, p_accepted, p_error_code
  );
END;
$$;

REVOKE ALL ON FUNCTION initialize_lifecycle_notification_delivery() FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_lifecycle_notification(uuid,timestamptz,timestamptz,text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_lifecycle_notification(
  uuid,integer,uuid,timestamptz,alert_notification_delivery_phase_enum,text,jsonb,text
) FROM PUBLIC;

GRANT SELECT, INSERT ON lifecycle_notification TO ledger_app;
REVOKE UPDATE, DELETE ON lifecycle_notification FROM ledger_app;
GRANT SELECT ON lifecycle_notification_delivery TO ledger_app;
REVOKE INSERT, UPDATE, DELETE ON lifecycle_notification_delivery FROM ledger_app;
GRANT EXECUTE ON FUNCTION claim_lifecycle_notification(uuid,timestamptz,timestamptz,text)
  TO ledger_app;
GRANT EXECUTE ON FUNCTION complete_lifecycle_notification(
  uuid,integer,uuid,timestamptz,alert_notification_delivery_phase_enum,text,jsonb,text
) TO ledger_app;
