-- US-038 / BR-20. Explanations never adjust the raw rollup/invoice comparison.
ALTER TABLE reconciliation_variance_line ADD COLUMN evidence_url text;
ALTER TABLE reconciliation_variance_line ADD CONSTRAINT reconciliation_evidence_http
  CHECK (evidence_url IS NULL OR evidence_url ~* '^https?://');
GRANT UPDATE, DELETE ON reconciliation_variance_line TO ledger_app;

CREATE FUNCTION guard_reconciliation_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.status <> 'open' THEN
    RAISE EXCEPTION 'RECONCILIATION_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.vendor_account_id,NEW.period,NEW.created_at) IS DISTINCT FROM (OLD.vendor_account_id,OLD.period,OLD.created_at) THEN
    RAISE EXCEPTION 'RECONCILIATION_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF NEW.invoice_amount_usd < 0 THEN
    RAISE EXCEPTION 'INVALID_INVOICE' USING ERRCODE='23514';
  END IF;
  IF NEW.invoice_amount_usd IS NOT NULL AND NEW.variance_usd IS DISTINCT FROM NEW.rollup_amount_usd-NEW.invoice_amount_usd THEN
    RAISE EXCEPTION 'RECONCILIATION_VARIANCE' USING ERRCODE='23514';
  END IF;
  IF NEW.status='reconciled' AND (NEW.invoice_amount_usd IS NULL OR abs(NEW.rollup_amount_usd-NEW.invoice_amount_usd)*200 > NEW.invoice_amount_usd) THEN
    RAISE EXCEPTION 'RECONCILIATION_OUTSIDE_TOLERANCE' USING ERRCODE='23514';
  END IF;
  IF NEW.status='overridden' AND (NEW.invoice_amount_usd IS NULL OR NEW.overridden_by IS NULL OR NEW.override_note IS NULL OR btrim(NEW.override_note)='') THEN
    RAISE EXCEPTION 'RECONCILIATION_OVERRIDE_NOTE_REQUIRED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reconciliation_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON reconciliation
FOR EACH ROW EXECUTE FUNCTION guard_reconciliation_evidence();

CREATE FUNCTION guard_reconciliation_variance_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; parent_status reconciliation_status_enum;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.reconciliation_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.reconciliation_id,OLD.created_by,OLD.created_at) THEN
    RAISE EXCEPTION 'VARIANCE_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN parent_id:=OLD.reconciliation_id; ELSE parent_id:=NEW.reconciliation_id; END IF;
  SELECT status INTO parent_status FROM reconciliation WHERE id=parent_id FOR UPDATE;
  IF parent_status IS DISTINCT FROM 'open'::reconciliation_status_enum THEN
    RAISE EXCEPTION 'RECONCILIATION_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reconciliation_variance_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON reconciliation_variance_line
FOR EACH ROW EXECUTE FUNCTION guard_reconciliation_variance_evidence();
