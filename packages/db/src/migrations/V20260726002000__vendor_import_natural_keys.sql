CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_account_vendor_id_vendor_org_ref
  ON public.vendor_account (vendor_id, vendor_org_ref)
  WHERE vendor_org_ref IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_integration_credential_active_kind
  ON public.integration_credential (vendor_account_id, kind)
  WHERE status = 'active';
