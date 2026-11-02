# US-053 — Production Docker Compose deployment

DEC-SMP-066 keeps deployment on Docker Compose. This runbook uses the actual
Next.js app, pg-boss worker, PostgreSQL, Keycloak and SMTP relay plus Caddy.
There is no separate API server. Azure Container Apps is a later change.

Operations entry point: [operations.md](operations.md), deployed at
`/auth/operations/operations.md` in the app image. Download the runbooks to the
private recovery kit before an outage. See [restore drill](restore-drill.md)
for recovery acceptance and known release blockers.

## Runtime contract

Use `infra/docker-compose.production.yml` alone, never as an override of the
development file. Docker Compose 2.24.4+ is required for the local override's
`!override` tag. Build images once and configure them at runtime. App/worker
run as UID 1001, log to stdout/stderr, and read database, auth, calendar and
SMTP settings from the environment. No production secrets are build arguments.
PostgreSQL, SMTP queue and Caddy certificates/config use persistent volumes.

Copy `infra/production/runtime.env.example` to `/etc/ledger/runtime.env` outside
the checkout, fill every required value, and set mode 0600. Keep that file in
the operator's secret store; do not paste `compose config` or `docker inspect`
output into CI logs because they contain resolved secrets. Use separate random
passwords for superuser, DDL owner, runtime app, read-only backup and Keycloak.
The owner password is only supplied to the migration job and PostgreSQL; app
and worker authenticate as `ledger_app`. The migration runner URL-encodes
passwords; arbitrary reserved characters do not corrupt connection URIs.

Generate a distinct environment KEK with `openssl rand -base64 32` outside Git.
Set `LEDGER_KEK_FILE` to that file; on Linux assign it to UID 1001 and mode 0400
or group 1001 with mode 0440. Compose file secrets retain host ownership and
permissions. It is mounted read-only at
`/run/ledger-secrets/credential-kek`, matching `readKekFile` (ADR-13). Escrow the
KEK separately from PostgreSQL and the backup decryption key. Do not regenerate
it when restarting or deploying. Rotation must rewrap existing DEKs before
retiring the old key; this story does not change the credential workflow.

Keycloak uses a separate `keycloak` database/role in PostgreSQL. New volumes
run the role bootstrap and import `realm-corporativo.json`. Startup import
skips an existing realm: client-secret rotation and realm updates require
explicit Keycloak administration, coordinated with runtime config. Its admin
API/console is not publicly proxied; use `docker compose exec keycloak` with
`kcadm.sh` through controlled host access. The realm has no pilot passwords.
Use the existing onboarding/import procedure to link pilot identities and
company roles; never add fabricated production users to the realm export.

## Host and DNS

Create A/AAAA records for `APP_DOMAIN` and `AUTH_DOMAIN` pointing at the approved
host. Remove stale AAAA records. Allow TCP 80/443 and restricted SSH; PostgreSQL,
Keycloak HTTP/management, SMTP and Next ports are not published. Caddy obtains
and renews certificates through ACME with `ACME_EMAIL`; retain its data volume.
Set both domains without a scheme/port. Caddy overwrites forwarded headers;
Keycloak trusts `xforwarded` only on the private Compose network and advertises
the canonical HTTPS issuer. DNS must resolve that issuer from inside the app.

Set a real upstream `SMTP_RELAYHOST`, allowed sender domains and optional
relay credentials. The production relay requires upstream TLS and persists its
queue. Maintain sender/escalation settings through the existing system-setting
workflow and verify actual delivery; relay health alone does not prove delivery.
Maintain `ECUADOR_HOLIDAYS` for the deployed year; a blank calendar fails closed.

## Deploy or upgrade

Use a story-tagged commit and record its SHA and image digests. From the checked
out release, build locally or load registry images pinned by digest:

```bash
export PRODUCTION_ENV_FILE=/etc/ledger/runtime.env
export PRODUCTION_PROJECT=ledger-production
bash infra/production/deploy.sh build  # manual host build
# Or deploy.sh pull for pre-published APP_IMAGE/WORKER_IMAGE/MIGRATION_IMAGE.
```

The script validates configuration, starts healthy infrastructure, always
recreates the one-shot migration job, and refuses rollout on a failed committed
migration or exact schema/runtime-grant verification. Only then does it wait
for healthy app, worker and Caddy. Migrations are append-only and checksum
verified. Never run `drizzle-kit push`. On an existing development volume,
provision the separate Keycloak DB/role and coordinate identity migration
explicitly; do not repurpose a development volume as production.

For repeat invocations use the same project name and env file. Inspect status
and bounded logs with the same Compose flags. Back up before an upgrade. To
roll back, restore the previous image digest values and run `deploy.sh pull`.
Schema must remain compatible with the previous release; never run down
migrations or delete persistent volumes as a rollback. For incompatible schema
use the isolated US-048 restore procedure and a planned cutover.

## Nightly encrypted backups

Follow [backup-restore.md](backup-restore.md) for key custody, signed/encrypted
artifact validation, retention and off-host copying. Build the existing backup
image with `docker build -t ledger-backup:local -f infra/backup/Dockerfile infra`.
Store these non-secret paths in `/etc/ledger/backup.env` (mode 0600):

```dotenv
PRODUCTION_ENV_FILE=/etc/ledger/runtime.env
PRODUCTION_PROJECT=ledger-production
BACKUP_SIGNING_KEY_FILE=/srv/ledger/secrets/backup-signing.key
BACKUP_OUTPUT_DIR=/srv/ledger/backups
```

The `ledger` operator must own the signing key (0600) and output directory and
have Docker access. The `BACKUP_AGE_RECIPIENT` in runtime.env is public; escrow
its distinct private identity off-host. Install the committed service and timer:

Production provisioning grants `BYPASSRLS` to the dedicated read-only
`ledger_backup` role: `pg_read_all_data` alone cannot dump RLS-protected tables.
The runtime `ledger_app` role never receives this attribute. On an initialized
production volume apply that role attribute as the PostgreSQL administrator
before scheduling the first dump; this is operational role provisioning,
not a change to an already-committed migration.

```bash
sudo install -m 0644 infra/production/ledger-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ledger-backup.timer
sudo systemctl start ledger-backup.service
systemctl list-timers ledger-backup.timer
journalctl -u ledger-backup.service --since today
```

This runs at 07:00 UTC (02:00 Guayaquil), catches missed runs, preserves failures
through `pipefail`, and binds the backup profile to the production project and
env file. It never starts a parallel development database. Confirm a complete
dump/manifest/signature set and off-host copy after the first scheduled run.
This timer backs up the Ledger database; Keycloak's separate database needs an
operator-managed PostgreSQL backup policy too before full disaster recovery
acceptance. The US-048 drill owns recovery acceptance.

## Localhost and CI proof

The operator selected localhost for this delivery. Run:

```bash
node --test infra/tests/production-compose.test.mjs
bash infra/production/rehearse.sh
```

The rehearsal creates private temporary config and an ephemeral KEK, builds
the same images, imports the realm, exports Caddy's local CA, and verifies
HTTPS using that CA (no insecure TLS flag). It checks server-side OIDC discovery,
public admin rejection, DB-backed app health, all service healthchecks, KEK
permissions, and persistence after restart. It listens only on loopback at
`https://ledger.localhost:18443` and `https://auth.localhost:18443`. Import the
exported root certificate into a browser only if you want interactive local
login. The app trusts only that extra CA through `NODE_EXTRA_CA_CERTS`.
The SMTP upstream is deliberately unroutable in this rehearsal.

The rehearsal also generates disposable age/Minisign keys, runs an encrypted
production backup, verifies its signature and ciphertext digest, decrypts it,
and checks that the archive includes the RLS-protected observation table.

For the operator-selected macOS localhost deployment, the registered LaunchAgent
is `com.smp.production-backup` in `~/Library/LaunchAgents/`. It runs
`infra/production/run-local-backup.sh` at 02:00 local time with private paths
under `~/.local/share/smp/production/`. Check `launchctl print
gui/$(id -u)/com.smp.production-backup` for the last exit status and inspect the
backup artifacts. This local schedule requires the user session and Docker
Desktop to be running. Disable it with `launchctl bootout
gui/$(id -u)/com.smp.production-backup` when retiring the local deployment.
The locally generated keys are rehearsal material; off-host escrow and human
production acceptance are still pending.

`.github/workflows/production-compose.yml` runs the same localhost deployment
on pull requests, main/infra-feature pushes and manual dispatch. It removes disposable volumes
with `REHEARSAL_CLEANUP=1`. It does not SSH to a host or claim a public deployment.
Retain the Actions run URL and SHA for first-CI-deploy acceptance. Locally,
the printed private env file and project name allow inspection and a repeat
`deploy.sh existing`; remove only that disposable project's volumes when done.

## S0 acceptance evidence

Record actual host/DNS, commit, image digests, CI URL, TLS checks, realm import,
login outcome, worker health, timer next/last run and backup artifact identities.
IT Director verifies real login and deployment health (AC1), environment key
custody and a live nightly backup (AC2), and the first CI deployment (AC3).
Do not count automated infrastructure checks as human acceptance.

S0's finance exit is separate: Central Finance inspects and exports M-1 for five
pilots; Company Finance compares its headcount to its supplied list. Manual data
is provisional and US-094 stays unverified until real export comparison. Work
on US-094/095, R2 integrations and already-completed baseline stories is outside
US-053. Only a human records acceptance for evidence actually seen.

For a later Azure Container Apps move, provide the same runtime variables and
KEK mount, run the migration image as a deployment job, replace local state with
managed PostgreSQL/SMTP/identity endpoints, and use platform ingress. There are
no Compose service names baked into the application images.
