CREATE OR REPLACE FUNCTION public.execute_cross_org_move(
  p_assignment_id uuid,
  p_target_vendor_account_id uuid,
  p_effective_on date,
  p_client_request_id text,
  p_actor_user_id uuid
)
RETURNS TABLE(destination_assignment_id uuid, outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $cross_org_move$
DECLARE
  source_row public.license_assignment%ROWTYPE;
  source_mode public.vendor_account_mode_enum;
  target_mode public.vendor_account_mode_enum;
  destination_request_id uuid;
  destination_id uuid;
  remove_action_id uuid;
  invite_action_id uuid;
BEGIN
  IF p_client_request_id IS NULL OR btrim(p_client_request_id) = '' THEN
    RAISE EXCEPTION 'clientRequestId is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_account actor
    WHERE actor.id = p_actor_user_id
      AND actor.status = 'active'
      AND actor.global_role = 'group_admin'
  ) THEN
    RAISE EXCEPTION 'CROSS_ORG_MOVE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'cross-org-move:' || p_assignment_id::text || ':' || p_client_request_id,
      0
    )
  );
  SELECT (audit.after->>'destinationAssignmentId')::uuid
    INTO destination_id
  FROM public.audit_log audit
  WHERE audit.entity_type = 'CrossOrgMove'
    AND audit.entity_id = p_assignment_id
    AND audit.after->>'clientRequestId' = p_client_request_id
  LIMIT 1;
  IF destination_id IS NOT NULL THEN
    RETURN QUERY SELECT destination_id, 'replayed'::text;
    RETURN;
  END IF;

  SELECT * INTO source_row
  FROM public.license_assignment assignment
  WHERE assignment.id = p_assignment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF source_row.ended_on IS NOT NULL THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_OPEN' USING ERRCODE = '23514';
  END IF;
  IF source_row.vendor_account_id = p_target_vendor_account_id THEN
    RAISE EXCEPTION 'CROSS_ORG_MOVE_REQUIRES_DISTINCT_ACCOUNTS'
      USING ERRCODE = '22023';
  END IF;
  IF source_row.source_request_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.license_request request
    WHERE request.id = source_row.source_request_id
      AND request.person_id = source_row.person_id
      AND request.company_id = source_row.company_id
      AND request.vendor_account_id = source_row.vendor_account_id
      AND request.license_type_id = source_row.license_type_id
  ) THEN
    RAISE EXCEPTION 'MOVE_REQUEST_MISMATCH' USING ERRCODE = '23514';
  END IF;
  SELECT source.mode, target.mode INTO source_mode, target_mode
  FROM public.vendor_account source
  JOIN public.vendor_account target
    ON target.id = p_target_vendor_account_id
   AND target.vendor_id = source.vendor_id
   AND target.status = 'active'
  JOIN public.license_type license
    ON license.id = source_row.license_type_id
   AND license.vendor_id = target.vendor_id
  WHERE source.id = source_row.vendor_account_id
    AND source.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MOVE_TARGET_INCOMPATIBLE' USING ERRCODE = '23514';
  END IF;

  UPDATE public.license_assignment
  SET ended_on = p_effective_on - 1,
      end_reason = 'inactive',
      note = 'Closed by cross-organization move'
  WHERE id = p_assignment_id;

  INSERT INTO public.license_request (
    request_no, person_id, company_id, vendor_account_id, license_type_id,
    state, justification, requested_by, decided_by, decided_at,
    decision_comment, created_at, created_by
  ) VALUES (
    'MOVE-' || gen_random_uuid()::text,
    source_row.person_id,
    source_row.company_id,
    p_target_vendor_account_id,
    source_row.license_type_id,
    'active',
    'Cross-organization move',
    p_actor_user_id,
    p_actor_user_id,
    CURRENT_TIMESTAMP,
    'Approved by cross-organization move command',
    CURRENT_TIMESTAMP,
    p_actor_user_id
  ) RETURNING id INTO destination_request_id;

  INSERT INTO public.license_assignment (
    person_id, company_id, vendor_account_id, license_type_id, started_on,
    source_request_id, source_kind, note, created_at, created_by
  ) VALUES (
    source_row.person_id, source_row.company_id, p_target_vendor_account_id,
    source_row.license_type_id, p_effective_on, destination_request_id,
    'request', 'Opened by cross-organization move', CURRENT_TIMESTAMP,
    p_actor_user_id
  ) RETURNING id INTO destination_id;

  INSERT INTO public.provisioning_action (
    request_id, vendor_account_id, kind, mode, status, raw_request, created_at
  ) VALUES (
    source_row.source_request_id, source_row.vendor_account_id, 'remove',
    source_mode::text::public.provisioning_action_mode_enum, 'confirmed',
    jsonb_build_object(
      'assignmentId', p_assignment_id,
      'clientRequestId', p_client_request_id,
      'operation', 'deprovision'
    ),
    CURRENT_TIMESTAMP
  ) RETURNING id INTO remove_action_id;

  INSERT INTO public.provisioning_action (
    request_id, vendor_account_id, kind, mode, status, raw_request, created_at
  ) VALUES (
    destination_request_id, p_target_vendor_account_id, 'invite',
    target_mode::text::public.provisioning_action_mode_enum, 'confirmed',
    jsonb_build_object(
      'assignmentId', p_assignment_id,
      'clientRequestId', p_client_request_id,
      'operation', 'provision'
    ),
    CURRENT_TIMESTAMP
  ) RETURNING id INTO invite_action_id;

  INSERT INTO public.audit_log (
    actor_user_id, action, entity_type, entity_id, company_id,
    before, after, occurred_at
  ) VALUES (
    p_actor_user_id, 'license_assignment.cross_org_move', 'CrossOrgMove',
    p_assignment_id, source_row.company_id,
    jsonb_build_object(
      'assignmentId', p_assignment_id,
      'vendorAccountId', source_row.vendor_account_id
    ),
    jsonb_build_object(
      'actionIds', jsonb_build_array(remove_action_id, invite_action_id),
      'clientRequestId', p_client_request_id,
      'destinationAssignmentId', destination_id,
      'destinationRequestId', destination_request_id,
      'vendorAccountId', p_target_vendor_account_id
    ),
    CURRENT_TIMESTAMP
  );
  RETURN QUERY SELECT destination_id, 'executed'::text;
END
$cross_org_move$;

REVOKE ALL ON FUNCTION public.execute_cross_org_move(uuid, uuid, date, text, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_cross_org_move(uuid, uuid, date, text, uuid)
  TO ledger_app;
