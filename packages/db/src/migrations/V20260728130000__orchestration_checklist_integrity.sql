CREATE UNIQUE INDEX uq_provisioning_action_orchestration_checklist_request
  ON provisioning_action (request_id)
  WHERE kind = 'checklist' AND mode = 'orchestration';

-- A failed action keeps its operator-supplied reason on the action record.
-- The immutable-action policy still forbids changing identity, mode, payload,
-- request, account, or creation fields.
GRANT UPDATE (failure_reason) ON provisioning_action TO ledger_app;
