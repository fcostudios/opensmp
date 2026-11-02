-- US-034 / BR-18: draft replacement is allowed, final financial evidence is immutable.
-- Keep raw runtime ledger deletes forbidden. The close command may replace
-- license lines only while their company-scoped parent is a locked draft.
CREATE FUNCTION public.clear_draft_license_lines(p_statement uuid, p_company uuid, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE parent_status public.statement_status_enum;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_account WHERE id=p_actor AND status='active'
    AND global_role IN ('central_finance','group_admin')) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='CLOSE_ACCESS_FORBIDDEN';
  END IF;
  SELECT status INTO parent_status FROM public.statement
    WHERE id=p_statement AND company_id=p_company FOR UPDATE;
  IF parent_status IS DISTINCT FROM 'draft'::public.statement_status_enum THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CLOSE_DRAFT_REQUIRED';
  END IF;
  DELETE FROM public.statement_line l USING public.statement s
    WHERE l.statement_id=s.id AND s.id=p_statement AND s.company_id=p_company AND l.kind='license';
END;
$$;
REVOKE ALL ON FUNCTION public.clear_draft_license_lines(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_draft_license_lines(uuid,uuid,uuid) TO ledger_app;

CREATE FUNCTION public.guard_final_statement() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='STATEMENT_FINAL_IMMUTABLE';
    END IF;
    IF (NEW.status <> OLD.status AND NOT (OLD.status='final' AND NEW.status='reconciled')) OR
      (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='STATEMENT_FINAL_IMMUTABLE';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER statement_final_immutable BEFORE UPDATE OR DELETE ON public.statement
FOR EACH ROW EXECUTE FUNCTION public.guard_final_statement();

CREATE FUNCTION public.guard_final_statement_line() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE parent_ids uuid[];
BEGIN
  IF TG_OP='INSERT' THEN parent_ids := ARRAY[NEW.statement_id];
  ELSIF TG_OP='DELETE' THEN parent_ids := ARRAY[OLD.statement_id];
  ELSE parent_ids := ARRAY[OLD.statement_id,NEW.statement_id]; END IF;
  -- Lock before checking the status so finalization cannot race a replacement.
  PERFORM id FROM public.statement WHERE id=ANY(parent_ids) ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.statement WHERE id=ANY(parent_ids) AND status <> 'draft') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='STATEMENT_FINAL_IMMUTABLE';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER a_statement_line_final_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.statement_line
FOR EACH ROW EXECUTE FUNCTION public.guard_final_statement_line();
