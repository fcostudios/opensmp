# Ledger operations — US-048

Start here from the deployed app at `/auth/operations/operations.md`, or from the
release checkout at `docs/runbooks/operations.md`. Keep an offline copy of this
directory and the deployed release SHA in the recovery vault: an app or
Keycloak outage must not prevent access to the procedures. Docker images
include this directory as public, read-only documentation. Never put secrets,
personal data, private host configuration or unsanitized drill logs here.

## Monthly manual register upkeep (DEC-SMP-065/066)

Group Admin keeps the register; Central Finance inspects and exports it;
Company Finance checks only its own company.

1. **Group Admin enters and closes assignments (US-095).** In `/registro`, use
   **Manual register entry**: record each joiner with the real start date, and
   close each leaver with **Close assignment**, giving the end date and reason.
   Every entry needs a note naming its source. The manual-entry form is shown
   to Group Admin only. Correct mistakes with a new audited entry or close;
   never edit assignment rows with SQL.
2. **Central Finance inspects.** In `/registro`, filter by company and vendor
   account, compare the source member list with the assignments, and check
   dated history and `/auditoria` for the actor, company and before/after
   evidence. Send any correction back to Group Admin for step 1.
3. **Central Finance exports the M-1 register (US-098).** Set **Active in
   month** to M-1 (for example `2026-10`) and press **Export CSV**. The CSV
   lists every seat active on at least one day of M-1, including seats open
   since an earlier month and leavers who ended during M-1 — the same
   assignments the license-only close bills for that month. Do not use
   `Start date`/`End date` for this: they match the assignment's *start*
   date only.
4. Each of the five pilots reconciles its month-end headcount and dated
   joiners/leavers against its supplied list. Record unresolved mismatches and
   the source date with the close evidence.

In `/tarifas`, Central Finance enters the monthly license rate and effective
date manually. Until the contracted rate arrives it is **provisional**
(DEC-SMP-066); label rehearsal exports/evidence accordingly. Use the latest
completed calendar month for the first real parallel close. A provisional
rate/invoice, an explained override, or a successful restore does not prove
S2/H2 acceptance. Preserve finals; compare draft seat-days and amounts line by
line and record every difference. No API key, usage import, or
SCR-credentials step is required for this license-only journey.

## Recovery order

1. IT Director declares the incident, records UTC start time, affected release,
   last successful backup, expected recovery point and communications owner.
   Freeze close scheduling and keep workers stopped in recovery; avoid sending
   duplicate statements or mail. Preserve production and its evidence.
2. Retrieve the recovery kit using the custody procedure below. Confirm the
   target is an isolated PostgreSQL cluster with no production app/worker.
3. Follow [encrypted backup and guarded restore](backup-restore.md). Use an
   absent database name, independently confirm the target system identifier,
   and use the guarded wrapper. A decrypt/list check alone is not a drill.
4. Follow [restore drill acceptance](restore-drill.md), including totals,
   migration checks and restore-role revocation. Keep the recovered app and
   worker disconnected from production identity, email and job execution.
5. Recover Keycloak separately if identity data is lost. The nightly Ledger
   dump does not contain the separate Keycloak database. Restore its approved
   database backup/configuration, TLS and issuer before testing real login.
6. IT Director approves a planned cutover only after finance compares the
   recovered register/statements and confirms the recovery point. Retain the
   old environment for investigation. Restart jobs only after checking which
   closes and notifications already ran. Record recovery end time and losses.

## Recovery key custody and retrieval (ADR-13)

The designated off-host vault namespace is
`Ledger/production/recovery/<key-id>`; provision it before go-live. This is a
required custody location, not a claim that escrow has already been completed.
The IT Director is primary custodian; the nominated infrastructure deputy is
secondary. Record their actual names, access mechanism and independent
emergency contact in the private operations inventory. Exercise access from a
second workstation without the application or Keycloak session.

Store the age private identity, matching public recipient, Minisign public
verification key and key IDs there, with the distinct environment credential
KEK and Keycloak recovery material in separately controlled entries. Store
backup artifacts in an independently administered off-host backup store; keep
the manifest/signature/checksum with each encrypted dump. Keep the signing
private key separately from decryption material. Record store path, last copy,
retention and deletion policy in the private inventory. Do not publish these
values in app documentation or Git.

For the current localhost rehearsal only, the existing recovery identity is
`~/.local/share/smp/production/backup-age.key`, verification key is
`backup-verify.pub`, KEK is `credential-kek`, and artifacts are in `backups/`
under that same private directory. These co-located rehearsal files are not
off-host escrow. Copy keys to a private recovery workspace with mode 0600;
check vault key IDs against the signed backup manifest before restoring. Use
the age identity only in the restore tools container; never mount it into the
application. After the drill remove the recovered secret copies and revoke
temporary vault access. Retain older decryption identities and verification
keys for all retained backups during rotation.

## Docker / Compose secret rotation (ADR-13)

Use the exact deployed project name and configuration; see
[deployment](production-deploy.md). Work from a protected host shell with
tracing disabled. Obtain an authorized maintenance window, current backup and
rollback image/configuration versions. Never paste resolved Compose config,
password-bearing URLs or shell environment into the incident record.

- Runtime env secrets: stage a versioned replacement `/etc/ledger/runtime.env`
  outside Git (0600), update the owning service first, then its consumers and
  recreate them with the deployed Compose flags. PostgreSQL password changes
  require role changes on existing volumes: replacing env files alone does
  not update database roles. The production `infra/production/deploy.sh` is
  not a password-rotation tool. Use protected `psql` `\password` prompts for
  the affected role; never put the password in SQL argv/history. Coordinate
  app and worker together for `ledger_app`, migration job for `ledger_owner`,
  backup for `ledger_backup`, and Keycloak for its own database role. Verify
  new authentication and rejection of the retired credential. Do not run the
  development role-convergence helper against production Compose by default.
- Keycloak client secrets: rotate through its controlled admin interface on
  the host, update the app/admin-client runtime secrets and recreate affected
  consumers. Startup realm import skips existing realms. Verify OIDC discovery,
  interactive login, role/company authorization and admin-client health.
  Rotate `NEXTAUTH_SECRET` in a coordinated window; existing sessions expire.
- Environment KEK: mount the replacement as a versioned Compose file secret
  at `/run/ledger-secrets/credential-kek`, readable by UID 1001 (0400/0440).
  First inventory existing `IntegrationCredential` rows. ADR-13 requires
  rewrapping every DEK with the new KEK and verifying decryption before old
  key retirement. This release has no bulk rewrap command: **do not swap the
  KEK when encrypted rows exist**. Escalate for a reviewed rewrap migration
  with rollback and verification; do not re-enter vendor credentials or use
  SCR-credentials as a recovery dependency. With no encrypted rows, record
  the empty inventory, replace the mount, recreate consumers, and verify
  health/file access. Retain the old KEK for historical backups.
- Backup keys: switch the public age recipient only after escrowing and
  retrieving the new private identity. Run a backup and guarded restore with
  that identity before retiring the old recipient. Rotate Minisign per
  [backup key rotation](backup-restore.md#key-custody-schedule-and-retention).

After each rotation inspect app/worker/identity health and actual backup/mail
outcomes, record key IDs (never key bytes), actor, UTC cutover, checks and
rollback result. Stop on failed checks; retain the prior keys/configuration
until recovery is proved. Revocation after compromise is an incident decision.

## Keycloak outage recovery (DEC-SMP-067 / CHG-115)

For R1, follow [Keycloak restart or restore](keycloak-recovery.md): recover the
existing service/realm, verify issuer discovery and login, and retain incident
evidence. Host-level recovery and these documents remain available without
SCR-credentials or a web login. Keep access closed if identity recovery fails.

Break-glass is deferred to R2 as **FEAT-R2-13** by DEC-SMP-067. Its missing
local-login/one-time-secret profile is no longer an R1 release blocker. Do not
try to enable it or bypass authentication during this R1 procedure.

Only a human records production `story verify`. Under DEC-SMP-067, the IT
Director's recovery journey is human acceptance at the S4 demo, separate from
development completion. Record unperformed human checks as `ac_unverifiable`,
not as development blockers; never claim them as performed.
