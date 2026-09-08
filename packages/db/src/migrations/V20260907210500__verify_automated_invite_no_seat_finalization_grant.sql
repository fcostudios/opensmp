-- US-064: fail release when the no-seat finalization grant is absent or broad.
DO $verify_automated_invite_no_seat_finalization_grant$
BEGIN
  IF NOT has_column_privilege(
    'ledger_app', 'public.provisioning_action', 'status', 'UPDATE'
  )
  OR NOT has_column_privilege(
    'ledger_app', 'public.provisioning_action', 'raw_response', 'UPDATE'
  )
  OR NOT has_column_privilege(
    'ledger_app', 'public.provisioning_action', 'resolved_at', 'UPDATE'
  )
  OR has_column_privilege(
    'ledger_app', 'public.provisioning_action', 'raw_request', 'UPDATE'
  )
  OR has_table_privilege(
    'ledger_app', 'public.provisioning_action',
    'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ) THEN
    RAISE EXCEPTION 'automated invite no-seat runtime grant mismatch';
  END IF;
END
$verify_automated_invite_no_seat_finalization_grant$;
