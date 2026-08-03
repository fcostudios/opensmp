CREATE TABLE identity_provider_operation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('create_user', 'disable_user', 'reset_two_factor')),
  status text NOT NULL CHECK (status IN ('pending', 'provider_applied', 'cleanup_pending', 'compensated', 'completed', 'failed')),
  actor_user_id uuid NOT NULL REFERENCES user_account(id),
  target_user_account_id uuid REFERENCES user_account(id),
  company_id uuid REFERENCES company(id),
  provider_subject text,
  payload jsonb NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempted_at timestamptz,
  next_retry_at timestamptz,
  original_failure text,
  cleanup_failure text,
  created_at timestamptz NOT NULL,
  completed_at timestamptz
);

CREATE INDEX idx_identity_provider_operation_retry
  ON identity_provider_operation (next_retry_at, created_at)
  WHERE status IN ('pending', 'provider_applied', 'cleanup_pending');

GRANT SELECT, INSERT, UPDATE ON identity_provider_operation TO ledger_app;

