\set ON_ERROR_STOP 1

-- Callers that already hold the maintenance lock set
-- restore_disable_lock_held=1. Existing-volume convergence acquires and
-- releases the same cluster maintenance lock itself.
\if :{?restore_disable_lock_held}
\else
\o /dev/null
SELECT pg_advisory_lock(741263, 2);
\o
\endif

BEGIN;
ALTER ROLE ledger_restore_admin NOLOGIN PASSWORD NULL VALID UNTIL 'epoch';
REVOKE ledger_owner FROM ledger_restore_admin;
COMMIT;

CREATE PROCEDURE pg_temp.ledger_disable_restore_sessions()
LANGUAGE plpgsql
AS $wait$
DECLARE
  attempt integer;
BEGIN
  FOR attempt IN 1..50 LOOP
    PERFORM pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE usename = 'ledger_restore_admin' AND pid <> pg_backend_pid();
    -- CALL runs at top level. Commit each termination pass so the next pass
    -- receives a fresh pg_stat_activity snapshot and catches authentication
    -- races that began before the NOLOGIN commit became visible.
    COMMIT;
    PERFORM pg_sleep(0.1);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename = 'ledger_restore_admin');
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename = 'ledger_restore_admin') THEN
    RAISE EXCEPTION 'restore-admin sessions remained after termination';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_authid
    WHERE rolname = 'ledger_restore_admin'
      AND (rolcanlogin OR rolpassword IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'restore-admin login or password remained enabled';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members m
    JOIN pg_roles parent ON parent.oid = m.roleid
    JOIN pg_roles member ON member.oid = m.member
    WHERE parent.rolname = 'ledger_owner'
      AND member.rolname = 'ledger_restore_admin'
  ) THEN
    RAISE EXCEPTION 'restore-admin owner membership remained enabled';
  END IF;
END
$wait$;
CALL pg_temp.ledger_disable_restore_sessions();
DROP PROCEDURE pg_temp.ledger_disable_restore_sessions();

SELECT rolcanlogin::text || '|' ||
  (SELECT rolpassword IS NULL FROM pg_authid WHERE rolname = 'ledger_restore_admin')::text || '|' ||
  (SELECT count(*) FROM pg_auth_members m JOIN pg_roles parent ON parent.oid = m.roleid JOIN pg_roles member ON member.oid = m.member WHERE parent.rolname = 'ledger_owner' AND member.rolname = 'ledger_restore_admin')::text || '|' ||
  (SELECT count(*) FROM pg_stat_activity WHERE usename = 'ledger_restore_admin')::text
FROM pg_roles WHERE rolname = 'ledger_restore_admin';

\if :{?restore_disable_lock_held}
\else
\o /dev/null
SELECT pg_advisory_unlock(741263, 2);
\o
\endif
