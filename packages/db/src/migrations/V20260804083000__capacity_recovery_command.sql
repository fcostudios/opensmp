-- US-023: least-privilege capacity recovery command for the worker runtime.
CREATE OR REPLACE FUNCTION public.recover_blocked_requests_for_capacity(
  p_capacity_id uuid,
  p_vendor_account_id uuid,
  p_license_type_id uuid,
  p_effective_from date,
  p_company_ids uuid[],
  p_occurred_at timestamptz
) RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_free integer;
  v_request record;
BEGIN
  IF cardinality(p_company_ids) IS NULL OR cardinality(p_company_ids) = 0 THEN
    RAISE EXCEPTION 'CAPACITY_RECOVERY_COMPANY_SCOPE_REQUIRED';
  END IF;

  SELECT greatest(
           0,
           selected.purchased_qty
             - (SELECT count(*) FROM public.license_assignment assignment
                WHERE assignment.vendor_account_id = p_vendor_account_id
                  AND assignment.license_type_id = p_license_type_id
                  AND assignment.started_on <= p_occurred_at::date
                  AND (assignment.ended_on IS NULL
                       OR assignment.ended_on >= p_occurred_at::date))
             - (SELECT count(*) FROM public.provisioning_action action
                JOIN public.license_request pending_request
                  ON pending_request.id = action.request_id
                 AND pending_request.vendor_account_id = action.vendor_account_id
                WHERE action.vendor_account_id = p_vendor_account_id
                  AND pending_request.license_type_id = p_license_type_id
                  AND action.kind = 'invite'
                  AND action.mode = 'automated'
                  AND action.status IN ('pending','sent'))
         )::integer
    INTO v_free
  FROM public.vendor_account_capacity selected
  WHERE selected.id = p_capacity_id
    AND selected.vendor_account_id = p_vendor_account_id
    AND selected.license_type_id = p_license_type_id
    AND selected.effective_from = p_effective_from
    AND selected.effective_from <= p_occurred_at::date
    AND NOT EXISTS (
      SELECT 1 FROM public.vendor_account_capacity newer
      WHERE newer.vendor_account_id = selected.vendor_account_id
        AND newer.license_type_id = selected.license_type_id
        AND newer.effective_from <= p_occurred_at::date
        AND (newer.effective_from, newer.created_at, newer.id) >
            (selected.effective_from, selected.created_at, selected.id)
    )
  FOR UPDATE OF selected;

  IF coalesce(v_free, 0) = 0 THEN
    RETURN;
  END IF;

  FOR v_request IN
    SELECT request.id, request.company_id, account.mode
    FROM public.license_request request
    JOIN public.person holder
      ON holder.id = request.person_id
     AND holder.company_id = request.company_id
    JOIN public.vendor_account account
      ON account.id = request.vendor_account_id
    WHERE request.state = 'blocked_no_seat'
      AND request.vendor_account_id = p_vendor_account_id
      AND request.license_type_id = p_license_type_id
      AND request.company_id = ANY(p_company_ids)
    ORDER BY request.created_at, request.id
    FOR UPDATE OF request SKIP LOCKED
    LIMIT v_free
  LOOP
    UPDATE public.license_request
    SET state = 'provisioning', updated_at = p_occurred_at
    WHERE id = v_request.id
      AND company_id = v_request.company_id
      AND state = 'blocked_no_seat';
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    INSERT INTO public.request_transition
      (request_id,from_state,to_state,actor_user_id,note,occurred_at)
    VALUES (v_request.id,'blocked_no_seat','provisioning',NULL,
            'Capacity became available',p_occurred_at);
    INSERT INTO public.provisioning_action
      (request_id,vendor_account_id,kind,mode,status,created_at)
    VALUES (v_request.id,p_vendor_account_id,
            CASE WHEN v_request.mode = 'automated'
                 THEN 'invite'::public.provisioning_action_kind_enum
                 ELSE 'checklist'::public.provisioning_action_kind_enum END,
            v_request.mode::text::public.provisioning_action_mode_enum,
            'pending',p_occurred_at);
    INSERT INTO public.audit_log
      (actor_user_id,action,entity_type,entity_id,company_id,note,before,after,occurred_at)
    VALUES (NULL,'request.provisioning','LicenseRequest',v_request.id,
            v_request.company_id,'Capacity became available',
            '{"state":"blocked_no_seat"}'::jsonb,
            '{"state":"provisioning"}'::jsonb,p_occurred_at);
    RETURN NEXT v_request.id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.recover_blocked_requests_for_capacity(
  uuid, uuid, uuid, date, uuid[], timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recover_blocked_requests_for_capacity(
  uuid, uuid, uuid, date, uuid[], timestamptz
) TO ledger_app;
