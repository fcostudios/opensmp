DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_owner') THEN
    CREATE ROLE ledger_owner LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_app') THEN
    CREATE ROLE ledger_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_backup') THEN
    CREATE ROLE ledger_backup LOGIN;
  END IF;
END $$;

-- A dump reader needs data visibility but cannot alter application data.
GRANT CONNECT ON DATABASE ledger TO ledger_backup;
GRANT pg_read_all_data TO ledger_backup;
