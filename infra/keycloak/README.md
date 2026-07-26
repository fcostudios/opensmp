# Ledger Keycloak realm

`realm-corporativo.json` is the production-safe realm definition for
DEC-SMP-014 and DEC-SMP-017. It contains no human users, passwords, OTP seeds,
or Ledger business roles.

## Identity and authorization boundary

- `smp-web` performs confidential OIDC authorization-code login with S256
  PKCE. Its callback is exactly `/api/auth/callback/keycloak`.
- `platform-admin` is a technical Keycloak role assigned through the
  `/platform-admin` group. The bound browser flow requires OTP for that role.
- `smp-keycloak-admin` is a service account limited to `manage-users`,
  `query-groups`, `view-users`, and `view-events`. It does not receive
  `realm-admin`.
- Ledger business authorization remains in PostgreSQL `UserAccount` and
  `CompanyRoleAssignment`.

## Secrets

The realm import resolves client secrets from
`SMP_WEB_CLIENT_SECRET` and `SMP_KEYCLOAK_ADMIN_CLIENT_SECRET`. Compose maps
those from `KEYCLOAK_CLIENT_SECRET` and `KEYCLOAK_ADMIN_CLIENT_SECRET`.
Production values must come from the deployment secret store; do not put their
values in this file.

Because startup realm import skips an existing realm, rotating a client secret
requires an explicit operator update followed by the corresponding application
secret rollout. Restarting Keycloak alone does not rotate persisted secrets.

## Authentication failure evidence

Keycloak retains login, logout, token-exchange, and OTP events for 90 days
(`7,776,000` seconds). Password and OTP failures remain in Keycloak and are not
copied into Ledger. An authorized operator can query them through:

```text
GET /admin/realms/corporativo/events?type=LOGIN_ERROR
GET /admin/realms/corporativo/events?type=UPDATE_TOTP_ERROR
```

The real-Keycloak integration test generates a failure, queries it with the
least-privilege service account, restarts Keycloak, and queries it again to
prove retained—not merely immediate—evidence.

## Test-only identities

`testing/users.json` and `testing/bootstrap-users.mjs` are mounted only by
`docker-compose.test.yml`. They contain deterministic CI identities and known
test passwords. They must never be mounted in a production Compose invocation.
The companion `seedAuthUsers` helper seeds only Ledger roles and grants into a
disposable test database.

Validate the import and the admin-service boundary with:

```bash
pnpm --filter smp-web exec vitest run \
  src/lib/auth/keycloak-admin.integration.test.ts
```
