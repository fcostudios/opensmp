DROP FUNCTION public.execute_cross_org_move(uuid, uuid, date, text, uuid);

CREATE UNIQUE INDEX uq_cross_org_move_client_request
  ON public.audit_log (
    entity_id,
    ((after->>'clientRequestId'))
  )
  WHERE entity_type = 'CrossOrgMove'
    AND after->>'clientRequestId' IS NOT NULL;
