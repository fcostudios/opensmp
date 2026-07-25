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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_restore_admin') THEN
    CREATE ROLE ledger_restore_admin NOLOGIN CREATEDB NOINHERIT NOSUPERUSER NOCREATEROLE PASSWORD NULL;
  END IF;
END $$;

-- Restore authority is disabled by default. Existing volumes are converged to
-- this state by apply-roles.sh; a separate audited maintenance window may
-- temporarily grant login and ledger_owner membership on an isolated target.
ALTER ROLE ledger_restore_admin NOLOGIN CREATEDB NOINHERIT NOSUPERUSER NOCREATEROLE PASSWORD NULL;
REVOKE ledger_owner FROM ledger_restore_admin;

-- A dump reader needs data visibility but cannot alter application data.
GRANT CONNECT ON DATABASE ledger TO ledger_backup;
-- Backup and restore coordinate on the stable administrative database with
-- the same advisory-lock key; this is deliberately separate from the source
-- application database, whose name may vary by environment.
GRANT CONNECT ON DATABASE postgres TO ledger_backup;
GRANT pg_read_all_data TO ledger_backup;
-- A backup manifest is bound to the physical PostgreSQL cluster. This is the
-- narrow extra capability the read-only backup role needs; it does not grant
-- DDL or mutation privileges.
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO ledger_backup;
-- The window supervisor authenticates the target cluster as super-admin. The
-- application owner alone keeps the function privilege outside that window.
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO ledger_owner;
