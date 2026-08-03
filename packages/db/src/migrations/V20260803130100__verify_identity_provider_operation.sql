DO $verify_identity_provider_operation$
BEGIN
  IF to_regclass('public.identity_provider_operation') IS NULL THEN
    RAISE EXCEPTION 'identity provider operation table missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'identity_provider_operation'
      AND indexname = 'idx_identity_provider_operation_retry'
  ) THEN
    RAISE EXCEPTION 'identity provider retry index missing';
  END IF;
  IF NOT has_table_privilege('ledger_app', 'identity_provider_operation', 'SELECT,INSERT,UPDATE') THEN
    RAISE EXCEPTION 'identity provider operation runtime privileges missing';
  END IF;
END
$verify_identity_provider_operation$;
