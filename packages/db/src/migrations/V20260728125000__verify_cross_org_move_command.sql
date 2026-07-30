-- US-022 AC: the cross-organization move command is callable only through the
-- restricted runtime seam and cannot inherit a caller-controlled search path.
DO $$
DECLARE
  command_oid oid;
  command_owner text;
  command_config text[];
  public_execute boolean;
BEGIN
  SELECT procedure.oid,
         owner.rolname,
         procedure.proconfig
    INTO command_oid, command_owner, command_config
  FROM pg_proc procedure
  JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
  JOIN pg_roles owner ON owner.oid = procedure.proowner
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'execute_cross_org_move'
    AND pg_get_function_identity_arguments(procedure.oid) =
      'p_assignment_id uuid, p_target_vendor_account_id uuid, p_effective_on date, p_client_request_id text, p_actor_user_id uuid'
    AND procedure.prosecdef;

  IF command_oid IS NULL
     OR command_owner <> 'ledger_owner'
     OR command_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
     OR NOT has_function_privilege('ledger_app', command_oid, 'EXECUTE') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'cross-organization move command security verification failed';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM aclexplode(
      coalesce(
        (SELECT proacl FROM pg_proc WHERE oid = command_oid),
        acldefault('f', (SELECT proowner FROM pg_proc WHERE oid = command_oid))
      )
    ) privilege
    WHERE privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) INTO public_execute;

  IF public_execute THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'cross-organization move command grants execute to PUBLIC';
  END IF;
END
$$;
