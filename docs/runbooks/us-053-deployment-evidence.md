# US-053 deployment evidence — 2026-11-01

Implementation source: `0a9881854befad25d2e08db44d0a5c5c9621ba8e`.
Operator-selected host: localhost. Project: `ledger-production`.
App: <https://ledger.localhost:18443>; identity: <https://auth.localhost:18443>.
TLS uses Caddy's local CA; browser trust is an operator action.

- Isolated story clone from `25a0f42`: frozen install, `pnpm type-check`,
  `pnpm lint`, `pnpm build`, and `pnpm test` passed (15/15 Turbo tasks).
  Other-session US-095 edits were excluded. The first test run had an unrelated
  analytics-ingestion cleanup-hook timeout; the complete rerun passed without
  changing tests or timeouts.
- All 64 committed migrations applied on fresh PostgreSQL; exact schema,
  append-only triggers and least-privilege application grants verified.
- [GitHub production deployment run 41355153207](https://github.com/fcostudios/opensmp/actions/runs/41355153207)
  passed: production images built, migrations verified, TLS app health,
  canonical OIDC discovery, public admin rejection, KEK access/permissions,
  all six service healthchecks, encrypted/signed backup verification, and
  persistence checks after restarting Keycloak/app/worker.
- Five deliberate configuration faults were rejected: published app port,
  owner-role runtime, Keycloak start-dev, migration bypass and wrong KEK mount.
- `pnpm test:mutation` exited successfully with zero mutatable files in this
  story's diff. No numerical mutation score is claimed for configuration.
- Local LaunchAgent `com.smp.production-backup` is registered for 02:00 local
  time. Three manual invocations were observed, latest exit code 0. Artifacts
  under `~/.local/share/smp/production/backups` have verified signatures and
  ciphertext digests; decryption and archive contents include the RLS table.
  Runtime configuration and keys live outside Git in that private directory.

The first CI run exposed unavailable exact Alpine APK revisions in the existing
backup image. Compatible patch/security revision constraints fixed the cold
build. Production provisioning also supplies the dedicated read-only backup
role's required `BYPASSRLS`; `ledger_app` retains its restricted grants.

This is development completion (`dev_done`), not human production acceptance.
AC1 still requires IT Director interactive login verification. AC2 still needs
real production key custody/off-host escrow acceptance. S0's finance inspection,
five-company M-1 export/headcount comparison and US-094 real-data acceptance
remain human work. Public DNS/ACME deployment and actual upstream mail delivery
are not claimed by the localhost rehearsal. No `done` or human `verified`
event is emitted.
