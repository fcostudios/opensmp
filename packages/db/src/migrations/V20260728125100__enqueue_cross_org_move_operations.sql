-- US-022 remediation: a move command enqueues two provider operations. The
-- register changes only after the later connector/checklist verification path.
DROP FUNCTION public.execute_cross_org_move(uuid, uuid, date, text, uuid);

CREATE FUNCTION public.execute_cross_org_move(
  p_assignment_id uuid,
  p_target_vendor_account_id uuid,
  p_effective_on date,
  p_client_request_id text,
  p_actor_user_id uuid
)
RETURNS TABLE(
  source_operation_id uuid,
  source_operation_kind public.provisioning_action_kind_enum,
  source_request_id uuid,
  destination_operation_id uuid,
  destination_operation_kind public.provisioning_action_kind_enum,
  destination_request_id uuid,
  outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $cross_org_move$
DECLARE
  source_assignment public.license_assignment%ROWTYPE;
  source_request public.license_request%ROWTYPE;
  source_mode public.vendor_account_mode_enum;
  target_mode public.vendor_account_mode_enum;
  v_source_operation_id uuid;
  v_source_operation_kind public.provisioning_action_kind_enum;
  v_destination_operation_id uuid;
  v_destination_operation_kind public.provisioning_action_kind_enum;
  v_destination_request_id uuid;
BEGIN
  IF p_client_request_id IS NULL OR btrim(p_client_request_id) = '' THEN
    RAISE EXCEPTION 'clientRequestId is required' USING ERRCODE = '22023';
  END IF;
  IF p_effective_on IS NULL THEN
    RAISE EXCEPTION 'effectiveOn is required' USING ERRCODE = '22023';
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

  SELECT (audit.after->>'sourceOperationId')::uuid,
         (audit.after->>'destinationOperationId')::uuid,
         (audit.after->>'destinationRequestId')::uuid
    INTO v_source_operation_id,
         v_destination_operation_id,
         v_destination_request_id
  FROM public.audit_log audit
  WHERE audit.entity_type = 'CrossOrgMove'
    AND audit.entity_id = p_assignment_id
    AND audit.after->>'clientRequestId' = p_client_request_id
  LIMIT 1;
  IF v_source_operation_id IS NOT NULL THEN
    SELECT action.kind
      INTO v_source_operation_kind
    FROM public.provisioning_action action
    WHERE action.id = v_source_operation_id;
    SELECT action.kind
      INTO v_destination_operation_kind
    FROM public.provisioning_action action
    WHERE action.id = v_destination_operation_id;
    RETURN QUERY SELECT
      v_source_operation_id,
      v_source_operation_kind,
      (SELECT action.request_id
       FROM public.provisioning_action action
       WHERE action.id = v_source_operation_id),
      v_destination_operation_id,
      v_destination_operation_kind,
      v_destination_request_id,
      'replayed'::text;
    RETURN;
  END IF;

  SELECT assignment.*
    INTO source_assignment
  FROM public.license_assignment assignment
  WHERE assignment.id = p_assignment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF source_assignment.ended_on IS NOT NULL THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_OPEN' USING ERRCODE = '23514';
  END IF;
  IF source_assignment.vendor_account_id = p_target_vendor_account_id THEN
    RAISE EXCEPTION 'CROSS_ORG_MOVE_REQUIRES_DISTINCT_ACCOUNTS'
      USING ERRCODE = '22023';
  END IF;

  SELECT request.*
    INTO source_request
  FROM public.license_request request
  JOIN public.person holder
    ON holder.id = request.person_id
   AND holder.company_id = request.company_id
  JOIN public.company tenant ON tenant.id = request.company_id
  WHERE request.id = source_assignment.source_request_id
    AND request.person_id = source_assignment.person_id
    AND request.company_id = source_assignment.company_id
    AND request.vendor_account_id = source_assignment.vendor_account_id
    AND request.license_type_id = source_assignment.license_type_id
    AND request.state = 'active'
  FOR UPDATE OF request;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MOVE_REQUEST_MISMATCH' USING ERRCODE = '23514';
  END IF;

  SELECT source.mode, target.mode
    INTO source_mode, target_mode
  FROM public.vendor_account source
  JOIN public.vendor_account target
    ON target.id = p_target_vendor_account_id
   AND target.vendor_id = source.vendor_id
   AND target.status = 'active'
  JOIN public.license_type license
    ON license.id = source_assignment.license_type_id
   AND license.vendor_id = target.vendor_id
   AND license.status = 'active'
  WHERE source.id = source_assignment.vendor_account_id
    AND source.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MOVE_TARGET_INCOMPATIBLE' USING ERRCODE = '23514';
  END IF;

  UPDATE public.license_request
  SET state = 'offboarding',
      updated_at = CURRENT_TIMESTAMP
  WHERE id = source_request.id
    AND state = 'active';
  INSERT INTO public.request_transition (
    request_id, from_state, to_state, actor_user_id, note, occurred_at
  ) VALUES (
    source_request.id, 'active', 'offboarding', p_actor_user_id,
    'Cross-organization move: enqueue source deprovision',
    CURRENT_TIMESTAMP
  );

  INSERT INTO public.license_request (
    request_no, person_id, company_id, vendor_account_id, license_type_id,
    state, justification, needed_by, requested_by, created_at, created_by
  ) VALUES (
    'MOVE-' || gen_random_uuid()::text,
    source_assignment.person_id,
    source_assignment.company_id,
    p_target_vendor_account_id,
    source_assignment.license_type_id,
    'submitted',
    'Cross-organization move',
    p_effective_on,
    p_actor_user_id,
    CURRENT_TIMESTAMP,
    p_actor_user_id
  ) RETURNING id INTO v_destination_request_id;

  INSERT INTO public.request_transition (
    request_id, from_state, to_state, actor_user_id, note, occurred_at
  ) VALUES (
    v_destination_request_id, 'submitted', 'pending_approval', p_actor_user_id,
    'Cross-organization move submitted',
    CURRENT_TIMESTAMP + interval '1 microsecond'
  );
  UPDATE public.license_request
  SET state = 'pending_approval',
      updated_at = CURRENT_TIMESTAMP
  WHERE id = v_destination_request_id
    AND state = 'submitted';

  INSERT INTO public.request_transition (
    request_id, from_state, to_state, actor_user_id, note, occurred_at
  ) VALUES (
    v_destination_request_id, 'pending_approval', 'approved', p_actor_user_id,
    'Cross-organization move approved',
    CURRENT_TIMESTAMP + interval '2 microseconds'
  );
  UPDATE public.license_request
  SET state = 'approved',
      decided_by = p_actor_user_id,
      decided_at = CURRENT_TIMESTAMP,
      decision_comment = 'Approved by cross-organization move command',
      updated_at = CURRENT_TIMESTAMP
  WHERE id = v_destination_request_id
    AND state = 'pending_approval';

  INSERT INTO public.request_transition (
    request_id, from_state, to_state, actor_user_id, note, occurred_at
  ) VALUES (
    v_destination_request_id, 'approved', 'provisioning', p_actor_user_id,
    'Cross-organization move: enqueue destination provision',
    CURRENT_TIMESTAMP + interval '3 microseconds'
  );
  UPDATE public.license_request
  SET state = 'provisioning',
      updated_at = CURRENT_TIMESTAMP
  WHERE id = v_destination_request_id
    AND state = 'approved';

  IF source_mode = 'automated' THEN
    v_source_operation_kind := 'remove';
  ELSE
    v_source_operation_kind := 'checklist';
  END IF;
  INSERT INTO public.provisioning_action (
    request_id, vendor_account_id, kind, mode, status, raw_request, created_at
  ) VALUES (
    source_request.id,
    source_assignment.vendor_account_id,
    v_source_operation_kind,
    source_mode::text::public.provisioning_action_mode_enum,
    'pending',
    CASE WHEN source_mode = 'orchestration'
      THEN jsonb_build_object(
        'checklist_steps',
        jsonb_build_array('remove_access', 'confirm_vendor_removal'),
        'clientRequestId', p_client_request_id,
        'operation', 'deprovision'
      )
      ELSE jsonb_build_object(
        'clientRequestId', p_client_request_id,
        'operation', 'deprovision'
      )
    END,
    CURRENT_TIMESTAMP
  ) RETURNING id INTO v_source_operation_id;

  IF target_mode = 'automated' THEN
    v_destination_operation_kind := 'invite';
  ELSE
    v_destination_operation_kind := 'checklist';
  END IF;
  INSERT INTO public.provisioning_action (
    request_id, vendor_account_id, kind, mode, status, raw_request, created_at
  ) VALUES (
    v_destination_request_id,
    p_target_vendor_account_id,
    v_destination_operation_kind,
    target_mode::text::public.provisioning_action_mode_enum,
    'pending',
    CASE WHEN target_mode = 'orchestration'
      THEN jsonb_build_object(
        'checklist_steps',
        jsonb_build_array(
          'invite_person',
          'assign_license',
          'confirm_vendor_provisioning'
        ),
        'clientRequestId', p_client_request_id,
        'operation', 'provision'
      )
      ELSE jsonb_build_object(
        'clientRequestId', p_client_request_id,
        'operation', 'provision'
      )
    END,
    CURRENT_TIMESTAMP
  ) RETURNING id INTO v_destination_operation_id;

  INSERT INTO public.audit_log (
    actor_user_id, action, entity_type, entity_id, company_id,
    before, after, occurred_at
  ) VALUES
    (
      p_actor_user_id, 'request.offboarding', 'LicenseRequest',
      source_request.id, source_assignment.company_id,
      '{"state":"active"}'::jsonb, '{"state":"offboarding"}'::jsonb,
      CURRENT_TIMESTAMP
    ),
    (
      p_actor_user_id, 'request.pending_approval', 'LicenseRequest',
      v_destination_request_id, source_assignment.company_id,
      '{"state":"submitted"}'::jsonb, '{"state":"pending_approval"}'::jsonb,
      CURRENT_TIMESTAMP + interval '1 microsecond'
    ),
    (
      p_actor_user_id, 'request.approved', 'LicenseRequest',
      v_destination_request_id, source_assignment.company_id,
      '{"state":"pending_approval"}'::jsonb, '{"state":"approved"}'::jsonb,
      CURRENT_TIMESTAMP + interval '2 microseconds'
    ),
    (
      p_actor_user_id, 'request.provisioning', 'LicenseRequest',
      v_destination_request_id, source_assignment.company_id,
      '{"state":"approved"}'::jsonb, '{"state":"provisioning"}'::jsonb,
      CURRENT_TIMESTAMP + interval '3 microseconds'
    );

  INSERT INTO public.audit_log (
    actor_user_id, action, entity_type, entity_id, company_id,
    before, after, occurred_at
  ) VALUES (
    p_actor_user_id,
    'license_assignment.cross_org_move_enqueued',
    'CrossOrgMove',
    p_assignment_id,
    source_assignment.company_id,
    jsonb_build_object(
      'assignmentId', p_assignment_id,
      'requestId', source_request.id,
      'requestState', 'active',
      'vendorAccountId', source_assignment.vendor_account_id
    ),
    jsonb_build_object(
      'clientRequestId', p_client_request_id,
      'destinationOperationId', v_destination_operation_id,
      'destinationRequestId', v_destination_request_id,
      'effectiveOn', p_effective_on,
      'sourceOperationId', v_source_operation_id,
      'sourceRequestState', 'offboarding',
      'targetRequestState', 'provisioning',
      'vendorAccountId', p_target_vendor_account_id
    ),
    CURRENT_TIMESTAMP
  );

  RETURN QUERY SELECT
    v_source_operation_id,
    v_source_operation_kind,
    source_request.id,
    v_destination_operation_id,
    v_destination_operation_kind,
    v_destination_request_id,
    'executed'::text;
END
$cross_org_move$;

REVOKE ALL ON FUNCTION public.execute_cross_org_move(uuid, uuid, date, text, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_cross_org_move(uuid, uuid, date, text, uuid)
  TO ledger_app;
