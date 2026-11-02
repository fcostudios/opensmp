# Encrypted nightly backup restore drill — US-048

Owner: IT Director, with Central Finance and Company Finance comparing results.
Run before go-live, after key changes, and periodically under the private
operations schedule. Record the release SHA and UTC times. Follow
[operations](operations.md) for key retrieval and outage handling and
[guarded restore](backup-restore.md#guarded-restore) for executable commands.
Use the production systemd timer or the localhost LaunchAgent from
[deployment](production-deploy.md#nightly-encrypted-backups), never the
development cron against the production stack. Check last exit status,
manifest time and off-host receipt each morning; a configured timer is not
evidence that a backup ran. Escalate a missing/failed nightly run immediately.

## Execute and challenge the recovery

1. Obtain the previous night’s complete four-file set from the off-host store,
   matching public verification key and escrowed age identity. Confirm its
   timestamp against the scheduler log and required recovery point. If it is
   stale, incomplete or only a manually generated backup, record that limit;
   do not certify the nightly schedule or go-live acceptance.
2. Capture comparison evidence at the backup recovery point: per-company
   register assignment counts, dated assignments/seat-days, statement counts
   and exact monetary totals by company/period/status/currency. Record all
   five pilot companies, including zeros. Avoid floating-point sums. Capture
   CloseRun identity/status and final statement identities so duplicates or
   changes to finals are visible. A later production snapshot may include new
   writes; explain differences rather than accepting a loose tolerance.
3. Start a separate PostgreSQL 16 cluster, without published ports or production
   app/worker connections. Provision `ledger_owner`, `ledger_app` and disabled
   `ledger_restore_admin` there using the release role definitions. Independently
   record its numeric IP and `pg_control_system().system_identifier`; it must
   differ from the source. Do not attach the tools container to production.
4. Use the full guarded-restore command in `backup-restore.md`, substituting
   the isolated network for `ledger_default`, the actual artifact/key paths,
   target IP/identifier and a new absent target database name. Keep tracing
   off. Mount a private audit file and dedicated staging directory as shown.
   No plaintext dump is written. Retain exit status and sanitized window audit.
5. The guarded restore intentionally revokes PUBLIC database access. On the
   confirmed isolated target, the owner must explicitly grant `CONNECT` on
   the recovered database to `ledger_app` for the verifier's runtime probes
   (for example, `GRANT CONNECT ON DATABASE ledger_drill TO ledger_app;`),
   then connect to that recovered database and run
   `GRANT USAGE ON SCHEMA public TO ledger_app;` because the guard also
   revokes the schema's default PUBLIC usage. Table/function ACLs come from
   the new backup; never replace them with broad grants.
   Keep app/worker disconnected; do not grant CONNECT to PUBLIC.
   Connect to the restored database with the owner and run the committed
   migration applier and exact schema verifier against that database. Do not
   point them at production or use `drizzle-kit push`. Confirm migration ledger
   checksums, schema/RLS/triggers and runtime grants. Compare the step-2
   register/statement evidence exactly; finance investigates every mismatch.
   An empty fixture proves transport/schema only, not five-company recovery.
6. Confirm the wrapper finalized restore authority: `ledger_restore_admin`
   has `rolcanlogin = false`, `rolpassword IS NULL`, no `ledger_owner`
   membership and zero sessions. Inspect the prepare/finalize audit events.
   If any postcondition fails, isolate the target and run emergency
   finalization before retrying, as documented in `backup-restore.md`.
7. Challenge failure paths using copies of the encrypted artifacts: alter
   ciphertext, omit a sidecar, use the wrong public key, wrong age identity,
   wrong target fingerprint and an already-existing destination. Each must
   fail without overwriting a database or leaving restore authority enabled.
   Do not mutate the retained original backup. Check role postconditions
   after each failure. A damaged dump that fails after creation may leave a
   quarantined staging database; inspect it by recorded OID before cleanup.
8. Serve the pinned recovered app in an isolated environment only after the
   schema checks. IT Director tests login and recovery documentation access;
   Company Finance verifies company isolation and its register/statements.
   Leave workers and SMTP disconnected until a separate cutover is approved.
   Remove only the identified disposable target after preserving evidence;
   never run production `down --volumes` as drill cleanup.

## Evidence and sign-off

Store full logs, snapshots and sensitive artifacts in the restricted incident
record; publish only sanitized facts. Record artifact basename, signed digest,
source/target identifiers, scheduler run timestamp, key IDs, vault retrieval
operator, restore start/end, command exit codes, migration/schema results,
per-company comparison result, negative checks, revocation/audit result and
cleanup. Calculate observed recovery point and elapsed recovery time; the story
defines no RPO/RTO promise, so do not invent an accepted target.

Record IT Director and finance names, acceptance date and any missing real
inputs. Human production acceptance requires a previous-night encrypted backup
and five-company register/statement comparison. Local development completion
cannot certify human acceptance or off-host escrow. Under DEC-SMP-067 /
CHG-115, break-glass is R2 (FEAT-R2-13); R1 identity recovery uses restart or
restore. Record unperformed off-host retrieval and the IT Director journey as
`ac_unverifiable` for the S4 demo, without blocking development completion.
See [current drill evidence](us-048-recovery-evidence.md).
