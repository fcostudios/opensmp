-- US-032 / BR-21: inclusive effective dates, concurrent no-overlap and final locks.
ALTER TABLE rate_card ADD COLUMN provisional boolean NOT NULL DEFAULT true;
ALTER TABLE rate_card ADD CONSTRAINT rate_card_valid_period
  CHECK (effective_to IS NULL OR effective_to >= effective_from);
ALTER TABLE rate_card ADD CONSTRAINT rate_card_nonnegative CHECK (monthly_rate_usd >= 0);
ALTER TABLE rate_card ADD CONSTRAINT rate_card_no_overlap EXCLUDE USING gist (
  vendor_account_id WITH =,
  license_type_id WITH =,
  daterange(effective_from, effective_to, '[]') WITH &&
);

-- Global financial catalog: no company_id. Consumption can belong to any company.
CREATE FUNCTION public.rate_card_is_locked(r public.rate_card) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.statement_line l
    JOIN public.statement s ON s.id = l.statement_id
    WHERE s.status IN ('final', 'reconciled') AND l.kind = 'license'
      AND l.vendor_account_id = r.vendor_account_id
      AND l.license_type_id = r.license_type_id
      AND daterange(r.effective_from, r.effective_to, '[]') &&
        daterange(COALESCE(l.period_from, (s.period || '-01')::date),
          COALESCE(l.period_to, ((s.period || '-01')::date + interval '1 month - 1 day')::date), '[]')
  );
$$;

CREATE FUNCTION public.guard_consumed_rate_card() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  -- Serialize with both existing status transitions and newly inserted consumers.
  -- Lock accounts in UUID order. Do not additionally lock statement rows here:
  -- their status UPDATE already owns its row before its trigger locks the pool.
  IF TG_OP = 'UPDATE' THEN
    PERFORM a.id FROM public.vendor_account a
      WHERE a.id IN (OLD.vendor_account_id, NEW.vendor_account_id)
      ORDER BY a.id FOR NO KEY UPDATE;
  ELSE
    PERFORM a.id FROM public.vendor_account a WHERE a.id = OLD.vendor_account_id
      FOR NO KEY UPDATE;
  END IF;
  -- A separate command gets a fresh READ COMMITTED snapshot after waiting.
  IF public.rate_card_is_locked(OLD) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RATE_LOCKED_NEW_PERIOD_REQUIRED';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rate_card_consumed_lock BEFORE UPDATE OR DELETE ON rate_card
  FOR EACH ROW EXECUTE FUNCTION public.guard_consumed_rate_card();
-- Lock the same pool before materializing consumption, including lines in a
-- transaction whose eventual final statement is not yet visible to rate edits.
CREATE FUNCTION public.serialize_statement_line_rate_consumption() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE account_ids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN account_ids := ARRAY[NEW.vendor_account_id];
  ELSIF TG_OP = 'DELETE' THEN account_ids := ARRAY[OLD.vendor_account_id];
  ELSE account_ids := ARRAY[OLD.vendor_account_id, NEW.vendor_account_id];
  END IF;
  PERFORM a.id FROM public.vendor_account a WHERE a.id = ANY(account_ids)
    ORDER BY a.id FOR NO KEY UPDATE;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER statement_line_rate_consumption_serialization
  BEFORE INSERT OR UPDATE OR DELETE ON public.statement_line
  FOR EACH ROW EXECUTE FUNCTION public.serialize_statement_line_rate_consumption();

CREATE FUNCTION public.serialize_statement_rate_finalization() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.status IN ('final', 'reconciled') AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM a.id FROM public.vendor_account a
      WHERE EXISTS (SELECT 1 FROM public.statement_line l
        WHERE l.statement_id = NEW.id AND l.kind = 'license' AND l.vendor_account_id = a.id)
      ORDER BY a.id FOR NO KEY UPDATE;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER statement_rate_finalization_serialization
  BEFORE UPDATE OF status ON public.statement
  FOR EACH ROW EXECUTE FUNCTION public.serialize_statement_rate_finalization();

-- Keep the baseline append-only runtime grants. Only this checked command may edit.
CREATE FUNCTION public.edit_unconsumed_rate_card(
  p_id uuid, p_actor uuid, p_amount numeric, p_from date, p_to date, p_provisional boolean
) RETURNS SETOF public.rate_card
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_account
    WHERE id = p_actor AND status = 'active' AND global_role IN ('central_finance', 'group_admin')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RATE_ACCESS_FORBIDDEN';
  END IF;
  RETURN QUERY UPDATE public.rate_card SET monthly_rate_usd = p_amount,
    effective_from = p_from, effective_to = p_to, provisional = p_provisional
    WHERE id = p_id RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.edit_unconsumed_rate_card(uuid,uuid,numeric,date,date,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edit_unconsumed_rate_card(uuid,uuid,numeric,date,date,boolean) TO ledger_app;
