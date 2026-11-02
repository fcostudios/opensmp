-- US-051: automated closes use the disabled system actor, with no login grant.
-- US-034 / BR-18: draft replacement is allowed, final financial evidence is immutable.
-- Keep raw runtime ledger deletes forbidden. The close command may replace
-- license lines only while their company-scoped parent is a locked draft.
CREATE OR REPLACE FUNCTION public.clear_draft_license_lines(p_statement uuid, p_company uuid, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE parent_status public.statement_status_enum;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_account WHERE id=p_actor AND status='active'
    AND global_role IN ('central_finance','group_admin'))
    AND NOT EXISTS (SELECT 1 FROM public.user_account WHERE id=p_actor
      AND id='00000000-0000-0000-0000-000000000001'::uuid
      AND email='system@ledger.invalid' AND status='disabled' AND global_role IS NULL) THEN
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

