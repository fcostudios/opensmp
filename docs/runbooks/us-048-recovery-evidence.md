# US-048 recovery evidence — 2026-11-01

Branch: `feature/ops/us-048-runbooks-restore-drill`. Operator-selected baseline:
localhost Docker Compose, project `ledger-production`. No production services
were restarted or reconfigured for this drill. Recovery used the separate
`us048-recovery` Docker network and disposable `us048-recovery-db` cluster.

## Actual encrypted restore

- Artifact: `ledger-20261101235118.dump.age`, created `2026-11-01T23:51:18Z`.
- Signed ciphertext SHA-256:
  `f331cafedb1687eb07eb68c6cd3bd4053f19d650584070269cf0b7500748e31f`.
- Source PostgreSQL system identifier: `7703322705419923490`.
- Final isolated target identifier: `7703355137002201128`.
- The existing localhost age identity and Minisign verification key were
  retrieved from the private rehearsal directory described in operations.md.
  This exercised local retrieval, not independent off-host escrow.
- The backup ran against the live localhost database using `ledger_backup`,
  the production backup tools, existing signing key and age recipient, and a
  separate private output directory. This was a manual run of the nightly
  backup mechanism, not evidence of an overnight scheduler invocation.
- The guarded tools container verified signature, checksum and provenance,
  streamed decryption into a single-transaction restore and promoted the new
  database. It restored five companies and 16 license assignments. Statement
  and statement-line counts were both zero; financial-total recovery remains
  unproven until statements exist. Per-company canonical register-row hashes
  for all five companies matched the live source exactly after restoration.
- All 65 committed migrations applied to a fresh database as `ledger_owner`.
  The same checksum ledger was verified on the restored database. Both exact
  schema checks passed: 33 application tables, six append-only triggers and
  the exact `ledger_app` runtime grant matrix. Only on the isolated target,
  explicit runtime CONNECT and public-schema USAGE were granted for verifier
  probes, following restore-drill.md.
- A second restore into the existing destination was rejected. Appending
  bytes to a private copy of the ciphertext was rejected before restore.
  After success and both failures, restore-admin state was exactly:
  NOLOGIN, null password hash, no owner membership, zero sessions. The
  prepare/prepared/finalize/finalized audit sequence was retained privately.

## Defects reproduced and repaired

The first actual restore failed because PostgreSQL 16's staging database
creator owned the public schema while restoration switched to `ledger_owner`
without granting schema creation. The regression now restores company A/B
rows exactly, asserts object ownership, denies backup-role schema creation and
checks restore-admin revocation. It failed before the fix and passes afterward.

The next exact verification exposed `pg_dump --no-acl`: restored
security-definer functions regained default PUBLIC EXECUTE and lost runtime
grants. Backups now retain ACLs. An added restricted-function oracle failed
before that fix and passes with it. Earlier no-ACL artifacts were preserved
and never exposed through an application; they cannot certify recovery.

Ten real-PostgreSQL restore-window checks pass, including expiry, confirmation,
credential symlink refusal, concurrent session termination, maintenance-lock
coordination and failed-restore finalization. The three focused backup/restore
checks pass. Four production Compose contract checks pass.

The built app image served all five linked operations runbooks with HTTP 200
at `/auth/operations/operations.md` and its relative links, with no session,
database configuration or Keycloak configuration. The entry point matched its
source bytes exactly. This used a disposable loopback-only app container;
the existing localhost production app was not redeployed. Package type-check,
lint, build and tests passed. The story-scoped mutation preflight (base
`d22b5c7`) found zero mutatable TypeScript files; shell defects were constrained
by the red/green real-PostgreSQL regression, not a claimed Stryker score.

## DEC-SMP-067 / CHG-115 update

The historical break-glass blocker is withdrawn. It is R2 FEAT-R2-13, outside
R1 acceptance. The new [Keycloak recovery runbook](keycloak-recovery.md) covers
restart and isolated identity-database restore. Past feedback remains intact.

The next scheduled localhost backup is 2026-11-02 at 02:00 America/Guayaquil
(07:00 UTC). Its actual artifact must be restored before AC2 is closed; the
manual rehearsal above does not substitute for it. The scheduled backup image
must include this branch's ACL-preservation repair.

Independent off-host escrow retrieval is not evidenced. Record that portion of
AC2 as `ac_unverifiable` for the S4 demo. The IT Director recovery journey
(AC3) is human S4 demo acceptance, also `ac_unverifiable` if unperformed, and
is not a development blocker under DEC-SMP-067. Finance acceptance and real
contracted rates remain separate; DEC-SMP-066 provisional labels still apply.
