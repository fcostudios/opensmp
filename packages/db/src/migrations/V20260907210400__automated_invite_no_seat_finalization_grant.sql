-- US-064: the runtime worker may atomically retain sanitized no-seat evidence
-- on an invitation action. Provider-controlled request data remains immutable.
GRANT UPDATE (status, raw_response, resolved_at)
  ON public.provisioning_action TO ledger_app;
