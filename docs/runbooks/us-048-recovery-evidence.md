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

The scheduled localhost backup ran on 2026-11-02 at 02:00:06
America/Guayaquil (07:00:06 UTC). Its actual artifact was restored on the
resumed session; the manual rehearsal above was not used as a substitute.
The scheduled backup includes this branch's ACL-preservation repair.

Independent off-host escrow retrieval is not evidenced. Record that portion of
AC2 as `ac_unverifiable` for the S4 demo. The IT Director recovery journey
(AC3) is human S4 demo acceptance, also `ac_unverifiable` if unperformed, and
is not a development blocker under DEC-SMP-067. Finance acceptance and real
contracted rates remain separate; DEC-SMP-066 provisional labels still apply.

## Scheduled nightly restore — 2026-11-02

- Artifact: `ledger-20261102070006.dump.age`, created `2026-11-02T07:00:06Z`.
- Ciphertext SHA-256:
  `42127adccd9fc888c02e76a32ecc15c6627d2a4d2acf856fe53cff0309da67fc`.
- LaunchAgent `com.smp.production-backup`: run count increased from 3 to 4;
  last exit code 0. The operator confirmed the nightly invocation; its manifest
  time matches the 02:00 schedule. No manual backup was substituted.
- Source cluster: `7703322705419923490`; isolated target:
  `7703544130789466152`. The guarded restore verified signature/ciphertext
  binding again, streamed decryption, and restored to an absent database on
  the separate `us048-recovery` network. Production services were not changed.
- Both a fresh database and the recovered database pass the **69 committed
  migrations**, exact 33-table schema, six append-only triggers and exact
  runtime grant matrix. Forward migrations from the archived schema were
  applied only to the isolated restored target.
- Existing-destination retry and tampered ciphertext were rejected. After
  success and each rejection, restore-admin was NOLOGIN, password-null,
  without owner membership and with zero sessions. Audit prepare/finalize
  evidence was retained privately.

Per-company assignment counts and hashes were compared against the live source
in the same resumed session. Each hash covers all assignment columns, rows
ordered by assignment ID, serialized as ASCII JSON with sorted object keys and
compact separators. Source and restored values match exactly:

| Provisional company | Source assignments | Restored assignments | Register SHA-256 (both) |
|---|---:|---:|---|
| PROV-094-01 | 2 | 2 | `acb92ff59d8974a14b6ace203752085bef878c0ed2f05afffe0cc86617096c19` |
| PROV-094-02 | 2 | 2 | `34b7b627113d4d6e95ab6000cc8b5476f731874048eea0cfddca6fe1a2f6d30c` |
| PROV-094-03 | 3 | 3 | `91837ea7d6c5f9e3c1c18b3827f77a17de8faef172f54069d70095173b1f9ada` |
| PROV-094-04 | 4 | 4 | `c16fd233e65748b26156d4644acdb2db6df49598c615235fac37cb459f3f6703` |
| PROV-094-05 | 5 | 5 | `cdc06cf3421be9ec37ec217c52618fa258cce7173f49b0ef9d2bb46fe40399d2` |

All five companies had zero source and restored statements; statement hashes
also match the canonical empty-array SHA-256. Total assignments: **16**.
These are explicitly provisional US-094 pilot records. No real finance-total,
contracted-rate, H2 or IT Director acceptance is inferred from this drill.

Machine-readable source/restored counts and hashes, comparison time and full
artifact identifiers: [scheduled-restore.json](../evidence/us-048/scheduled-restore.json).
Off-host escrow retrieval remains `ac_unverifiable` until the IT Director
performs it; AC3's recovery journey remains `ac_unverifiable` for the S4 demo.
Under DEC-SMP-067 / CHG-115 these are human acceptance, not development blockers.
