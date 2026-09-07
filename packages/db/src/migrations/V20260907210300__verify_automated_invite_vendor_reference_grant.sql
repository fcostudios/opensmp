-- US-063: fail release if the invitation finalization grant is absent or broad.
DO $verify_automated_invite_vendor_reference_grant$
BEGIN
  IF NOT has_column_privilege(
    'ledger_app',
    'public.provisioning_action',
    'vendor_ref',
    'UPDATE'
  )
  OR has_column_privilege(
    'ledger_app',
    'public.provisioning_action',
    'raw_request',
    'UPDATE'
  )
  OR has_column_privilege(
    'ledger_app',
    'public.provisioning_action',
    'raw_response',
    'UPDATE'
  )
  OR has_table_privilege(
    'ledger_app',
    'public.provisioning_action',
    'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ) THEN
    RAISE EXCEPTION 'automated invite runtime grant mismatch';
  END IF;
END
$verify_automated_invite_vendor_reference_grant$;
