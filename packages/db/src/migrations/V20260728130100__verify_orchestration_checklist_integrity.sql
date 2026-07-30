DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'provisioning_action'
      AND indexname =
        'uq_provisioning_action_orchestration_checklist_request'
  ) THEN
    RAISE EXCEPTION 'orchestration checklist uniqueness index is missing';
  END IF;

  IF NOT has_column_privilege(
    'ledger_app',
    'public.provisioning_action',
    'failure_reason',
    'UPDATE'
  ) THEN
    RAISE EXCEPTION 'ledger_app cannot persist checklist failure reason';
  END IF;
END
$$;
