-- US-003: idempotent system defaults require a stable disabled system actor.

INSERT INTO user_account (id, email, status, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'system@ledger.invalid',
  'disabled',
  now()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO system_setting (key, value, updated_at, updated_by) VALUES
  ('notif_sender_email', '"ledger@corporativo.ec"'::jsonb, now(), '00000000-0000-0000-0000-000000000001'),
  ('notif_escalation_email', '"admin@corporativo.ec"'::jsonb, now(), '00000000-0000-0000-0000-000000000001'),
  ('default_language', '"es"'::jsonb, now(), '00000000-0000-0000-0000-000000000001')
ON CONFLICT (key) DO NOTHING;
