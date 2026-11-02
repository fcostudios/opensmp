-- US-038: legacy evidence used invoice minus rollup; BR-20 governs magnitude.
-- Retain both signed conventions without permitting inconsistent variance magnitudes.
CREATE OR REPLACE FUNCTION guard_reconciliation_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF NEW.invoice_amount_usd IS NOT NULL AND abs(NEW.variance_usd) IS DISTINCT FROM abs(NEW.rollup_amount_usd-NEW.invoice_amount_usd) THEN
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
