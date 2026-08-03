DROP FUNCTION IF EXISTS public.revoke_company_role_assignment(uuid, uuid, uuid);

CREATE FUNCTION public.revoke_company_role_assignment(
  p_assignment_id uuid,
  p_company_id uuid,
  p_actor_user_id uuid,
  p_note text
)
RETURNS TABLE (
  id uuid,
  user_account_id uuid,
  company_id uuid,
  role company_role_assignment_role_enum,
  unique_grant text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  assignment_row public.company_role_assignment%ROWTYPE;
  deleted_assignment public.company_role_assignment%ROWTYPE;
BEGIN
  IF p_note IS NULL OR btrim(p_note) = '' THEN
    RAISE EXCEPTION 'role revocation note is required' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO assignment_row
  FROM public.company_role_assignment AS role_assignment
  WHERE role_assignment.id = p_assignment_id
    AND role_assignment.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO public.audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    company_id,
    note,
    before,
    after,
    occurred_at
  ) VALUES (
    p_actor_user_id,
    'identity.company_role.removed',
    'CompanyRoleAssignment',
    assignment_row.id,
    assignment_row.company_id,
    p_note,
    to_jsonb(assignment_row),
    NULL,
    now()
  );

  DELETE FROM public.company_role_assignment AS role_assignment
  WHERE role_assignment.id = p_assignment_id
    AND role_assignment.company_id = p_company_id
  RETURNING * INTO deleted_assignment;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'company-role assignment disappeared while locked';
  END IF;

  RETURN QUERY
  SELECT
    deleted_assignment.id,
    deleted_assignment.user_account_id,
    deleted_assignment.company_id,
    deleted_assignment.role,
    deleted_assignment.unique_grant;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_company_role_assignment(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_company_role_assignment(uuid, uuid, uuid, text) TO ledger_app;
