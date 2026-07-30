DO $$
DECLARE
  command_oid oid;
  command_definition text;
  command_config text[];
  command_owner text;
  command_result text;
  public_execute boolean;
BEGIN
  SELECT procedure.oid,
         pg_get_functiondef(procedure.oid),
         procedure.proconfig,
         owner.rolname,
         pg_get_function_result(procedure.oid)
    INTO command_oid,
         command_definition,
         command_config,
         command_owner,
         command_result
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
     OR command_result NOT LIKE
       'TABLE(source_operation_id uuid, source_operation_kind provisioning_action_kind_enum,%destination_operation_id uuid,%outcome text)'
     OR command_definition ILIKE '%UPDATE public.license_assignment%'
     OR command_definition ILIKE '%INSERT INTO public.license_assignment%'
     OR NOT has_function_privilege('ledger_app', command_oid, 'EXECUTE') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'enqueued cross-organization move verification failed';
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
      MESSAGE = 'enqueued cross-organization move grants execute to PUBLIC';
  END IF;
END
$$;
