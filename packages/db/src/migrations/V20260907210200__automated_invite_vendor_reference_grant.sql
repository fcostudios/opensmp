-- US-063: the runtime worker may finalize a known invitation reference, but
-- provider request/response payloads remain immutable and unavailable to it.
GRANT UPDATE (vendor_ref) ON public.provisioning_action TO ledger_app;
