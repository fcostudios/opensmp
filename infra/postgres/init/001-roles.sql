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
    CREATE ROLE ledger_restore_admin LOGIN CREATEDB NOINHERIT NOSUPERUSER NOCREATEROLE;
  END IF;
END $$;

-- A dump reader needs data visibility but cannot alter application data.
GRANT CONNECT ON DATABASE ledger TO ledger_backup;
GRANT pg_read_all_data TO ledger_backup;
-- A backup manifest is bound to the physical PostgreSQL cluster. This is the
-- narrow extra capability the read-only backup role needs; it does not grant
-- DDL or mutation privileges.
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO ledger_backup;
-- Restore administration may create a fresh target database. It deliberately
-- inherits none of the owner powers; the restore session SET ROLEs only after
-- checking the authenticated target cluster and empty staging database.
GRANT ledger_owner TO ledger_restore_admin;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO ledger_restore_admin;
-- The restore transaction checks its independently confirmed target cluster
-- before it SET ROLEs to this owner.
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO ledger_owner;
