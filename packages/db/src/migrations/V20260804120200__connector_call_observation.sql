-- US-057: provider-neutral append-only evidence, independent of company scope.
CREATE TYPE public.connector_call_operation_enum AS ENUM ('provision', 'deprovision', 'sync_members', 'sync_activity', 'sync_cost');
CREATE TYPE public.connector_call_phase_enum AS ENUM ('requested', 'succeeded', 'failed');

CREATE TABLE public.connector_call_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_account_id uuid NOT NULL REFERENCES public.vendor_account(id),
  provisioning_action_id uuid REFERENCES public.provisioning_action(id),
  correlation_id uuid NOT NULL,
  operation public.connector_call_operation_enum NOT NULL,
  attempt integer NOT NULL,
  phase public.connector_call_phase_enum NOT NULL,
  classification text,
  summary jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  CONSTRAINT connector_call_attempt_check CHECK (attempt >= 1),
  CONSTRAINT connector_call_summary_check CHECK (jsonb_typeof(summary) = 'object'),
  CONSTRAINT connector_call_classification_check CHECK (
    (phase = 'requested' AND classification IS NULL)
    OR (phase = 'succeeded' AND classification IS NOT NULL AND classification = 'success')
    OR (phase = 'failed' AND classification IS NOT NULL AND classification IN ('rate_limited', 'provider_error', 'client_error'))
  ),
  CONSTRAINT connector_call_sync_action_check CHECK (operation IN ('provision', 'deprovision') OR provisioning_action_id IS NULL),
  CONSTRAINT uq_connector_call_phase UNIQUE (correlation_id, attempt, phase)
);
CREATE UNIQUE INDEX uq_connector_call_terminal ON public.connector_call_observation (correlation_id, attempt)
  WHERE phase IN ('succeeded', 'failed');
CREATE INDEX idx_connector_call_vendor_account ON public.connector_call_observation (vendor_account_id);
CREATE INDEX idx_connector_call_action ON public.connector_call_observation (provisioning_action_id);
CREATE INDEX idx_connector_call_correlation ON public.connector_call_observation (correlation_id);
CREATE INDEX idx_connector_call_operation ON public.connector_call_observation (operation);
CREATE INDEX idx_connector_call_occurred_at ON public.connector_call_observation (occurred_at);

CREATE FUNCTION public.validate_connector_call_observation() RETURNS trigger
LANGUAGE plpgsql AS $validate$
DECLARE
  context_row public.connector_call_observation%ROWTYPE;
  last_attempt integer;
BEGIN
  -- A transaction-scoped lock makes concurrent appends use one correlation order.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.correlation_id::text, 57057));
  IF NEW.provisioning_action_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.provisioning_action
    WHERE id = NEW.provisioning_action_id AND vendor_account_id = NEW.vendor_account_id
  ) THEN
    RAISE EXCEPTION 'connector call action/account mismatch' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO context_row FROM public.connector_call_observation
    WHERE correlation_id = NEW.correlation_id ORDER BY attempt, phase LIMIT 1;
  IF FOUND AND (
    context_row.vendor_account_id IS DISTINCT FROM NEW.vendor_account_id
    OR context_row.operation IS DISTINCT FROM NEW.operation
    OR context_row.provisioning_action_id IS DISTINCT FROM NEW.provisioning_action_id
  ) THEN
    RAISE EXCEPTION 'connector call correlation context mismatch' USING ERRCODE = '23514';
  END IF;
  IF NEW.phase = 'requested' THEN
    SELECT COALESCE(MAX(attempt), 0) INTO last_attempt FROM public.connector_call_observation
      WHERE correlation_id = NEW.correlation_id AND phase = 'requested';
    IF NEW.attempt <> last_attempt + 1 THEN
      RAISE EXCEPTION 'connector call requested attempt must be sequential' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.connector_call_observation
      WHERE correlation_id = NEW.correlation_id AND attempt = NEW.attempt AND phase = 'requested'
    ) THEN
      RAISE EXCEPTION 'connector call terminal requires requested' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.connector_call_observation
      WHERE correlation_id = NEW.correlation_id AND attempt = NEW.attempt AND phase IN ('succeeded', 'failed')
    ) THEN
      RAISE EXCEPTION 'connector call already has terminal outcome' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$validate$;
CREATE TRIGGER trg_connector_call_validate BEFORE INSERT ON public.connector_call_observation
  FOR EACH ROW EXECUTE FUNCTION public.validate_connector_call_observation();

CREATE FUNCTION public.prevent_connector_call_mutation() RETURNS trigger
LANGUAGE plpgsql AS $append_only$
BEGIN
  RAISE EXCEPTION 'connector call observations are append-only' USING ERRCODE = '55000';
END;
$append_only$;
CREATE TRIGGER trg_connector_call_append_only BEFORE UPDATE OR DELETE ON public.connector_call_observation
  FOR EACH ROW EXECUTE FUNCTION public.prevent_connector_call_mutation();

REVOKE ALL ON FUNCTION public.validate_connector_call_observation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_connector_call_mutation() FROM PUBLIC;
GRANT SELECT, INSERT ON connector_call_observation TO ledger_app;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON connector_call_observation FROM ledger_app;
