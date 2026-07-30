DROP INDEX IF EXISTS uq_provisioning_action_orchestration_checklist_request;

CREATE UNIQUE INDEX
  uq_provisioning_action_orchestration_checklist_operation
ON provisioning_action (
  request_id,
  ((raw_request ->> 'operation'))
)
WHERE kind = 'checklist'
  AND mode = 'orchestration'
  AND raw_request ->> 'operation' IN ('provision', 'deprovision');
