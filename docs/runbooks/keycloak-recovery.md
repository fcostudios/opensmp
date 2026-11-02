# Keycloak outage: restart or restore — US-048

Authority: DEC-SMP-067 / CHG-115. R1 uses the existing Keycloak realm and
PostgreSQL recovery; break-glass is R2 (FEAT-R2-13). IT Director owns recovery
and S4 demo acceptance. These host operations require no SCR-credentials.

## Diagnose and restart

From the checked-out deployed release, in a protected operator shell:

```bash
set -euo pipefail
set +x
export PRODUCTION_ENV_FILE=/etc/ledger/runtime.env
export PRODUCTION_PROJECT=ledger-production
compose=(docker compose --project-name "$PRODUCTION_PROJECT"
  --env-file "$PRODUCTION_ENV_FILE" -f infra/docker-compose.production.yml)
# On the existing localhost deployment, use its private runtime.env path
# instead and include the committed local override, with LOCAL_CA_DIR set:
# compose+=(-f infra/production/docker-compose.local.yml)
"${compose[@]}" ps postgres keycloak
"${compose[@]}" logs --tail 100 keycloak
"${compose[@]}" restart keycloak
"${compose[@]}" up -d --no-deps --wait --wait-timeout 360 keycloak
```

Check PostgreSQL health, disk space, canonical issuer DNS, Caddy TLS and the
private Keycloak database credentials if restart fails. Inspect logs privately;
publish only sanitized error categories/times. Preserve persistent volumes and
the previous image digest. Never use `down --volumes`, `start-dev`, an empty
replacement realm, a local password bypass or SQL business-role grants.

Verify the configured HTTPS issuer's
`/realms/corporativo/.well-known/openid-configuration` returns 200 and its
`issuer` is exactly the deployed issuer. Use normal certificate validation;
for localhost supply its existing Caddy CA with `curl --cacert`. Confirm the
app login redirects to that issuer. IT Director signs in with an existing
identity and TOTP, then checks its database-enriched company/role grants and
that an unauthorized company remains inaccessible. Retain service health,
login/audit and failed-access evidence. A healthcheck alone is not acceptance.

## Restore lost or corrupt identity data

The Ledger nightly dump does **not** include Keycloak's separate `keycloak`
database. Before go-live the private recovery inventory must name a distinct
encrypted, signed Keycloak database backup, its scheduler, image digest,
matching configuration and escrowed keys. Startup realm JSON import skips an
existing realm and cannot recover users, TOTP or their stable subject IDs.
Without this identity backup, keep access closed and escalate to IT Director;
do not fabricate a successful recovery or recreate users with new subjects.

1. Freeze the recovery app and worker. Preserve the failed source cluster and
   logs. Obtain the identity database backup and matching age identity/public
   verification key through [key custody](operations.md#recovery-key-custody-and-retrieval-adr-13).
   Verify its signed manifest, ciphertext digest/size and source provenance
   using the release backup verification tools before any target mutation.
2. Provision an isolated PostgreSQL 16 recovery cluster and private Docker
   network. Independently confirm its numeric endpoint/system identifier and
   that it has no production app/worker. Create a `keycloak` role using the
   approved secret and a new absent database `keycloak_recovery` owned by that
   role, from `template0`. Never overwrite the live identity database.
3. The Ledger guarded wrapper opens only `ledger_owner` authority; do not
   repurpose it to grant identity privileges. Use the protected recovery
   cluster administrator for this separate database recovery. With the
   variables below set to independently verified private paths/container,
   stream the verified identity archive into the isolated database:

   ```bash
   set -euo pipefail
   set +x
   # RECOVERY_POSTGRES is the disposable target container, not production.
   # KEYCLOAK_BACKUP_DIR contains the verified artifact and age identity.
   # KEYCLOAK_BACKUP_NAME is the verified ciphertext basename, without a path.
   # Run only after confirming keycloak_recovery is new, empty and isolated.
   {
     printf '%s\n' 'SET ROLE keycloak;'
     docker run --rm --user "$(id -u):$(id -g)" \
       --mount "type=bind,src=$KEYCLOAK_BACKUP_DIR,dst=/recovery,readonly" \
       --env KEYCLOAK_BACKUP_NAME --entrypoint bash ledger-backup:local \
       -euo pipefail -c 'age -d -i /recovery/identity.txt "/recovery/$KEYCLOAK_BACKUP_NAME" | pg_restore --no-owner --exit-on-error --file=-'
   } | docker exec -i "$RECOVERY_POSTGRES" psql --no-psqlrc \
     --username postgres --dbname keycloak_recovery \
     --single-transaction --set ON_ERROR_STOP=1
   ```

   This requires controlled host administrator access and local socket admin
   authentication on the disposable container. For an external target use its
   protected administrator connection with discrete libpq variables, never a
   password-bearing URI/argv. Provision any additional roles referenced by the
   archive ACLs before restoring; do not discard ACLs to make a failure pass.
4. On failure, keep the database quarantined for inspection; do not start
   Keycloak. On success, compare realm/client/user counts and stable subject
   IDs with backup-point evidence. Retain IDs and sensitive identity data only
   in the private incident record. Match the deployed Keycloak version,
   client secrets, realm, issuer and TLS settings to the recovered data.
5. Start a separate Keycloak service against `keycloak_recovery` on the
   isolated network using the approved runtime configuration. Test discovery
   and an existing identity's TOTP/login before considering cutover. Preserve
   `UserAccount.idp_subject` mappings: Ledger remains the business-role source.
   Do not publish identity recovery admin endpoints or enable outbound jobs.
6. IT Director approves a planned cutover to the recovered identity endpoint,
   coordinates issuer/client configuration with app sessions, and repeats the
   restart-path login, company-isolation and audit checks. Record the recovery
   point, elapsed time, data loss, image/configuration versions and disposition
   of the old cluster. Resume workers only after duplicate-close/mail checks.

This is the R1 operating procedure, not evidence that a human journey has run.
At the S4 demo record any unperformed IT Director journey or independent
off-host escrow retrieval as `ac_unverifiable`. Keep historical feedback intact.
