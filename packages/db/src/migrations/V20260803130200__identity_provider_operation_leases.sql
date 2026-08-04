ALTER TABLE identity_provider_operation
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_expires_at timestamptz,
  ADD CONSTRAINT identity_provider_operation_lease_pair_check CHECK (
    (lease_token IS NULL AND lease_expires_at IS NULL)
    OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  );

UPDATE identity_provider_operation
SET next_retry_at = created_at
WHERE status IN ('pending', 'provider_applied', 'cleanup_pending')
  AND next_retry_at IS NULL;

