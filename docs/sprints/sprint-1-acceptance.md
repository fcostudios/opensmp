# Sprint 1 Acceptance Record

**Sprint:** Sprint 1 — Foundations  
**Branch:** `feature/platform/sprint-1-foundations`  
**Acceptance date:** 2026-07-26  
**Execution contract:** [DEC-SMP-017](../decisions/DEC-SMP-017-sprint-1-execution-contract.md) / CHG-001  
**Plan:** [2026-07-24 Sprint 1 foundations](../superpowers/plans/2026-07-24-sprint-1-foundations.md), Task 24

## Verdict

The eight stories without mandatory external operations are implemented,
adversarially verified, independently reviewed, and recorded `done`:
US-001, US-002, US-003, US-004, US-005, US-006, US-008, and US-046.

US-007 and US-054 have complete, independently approved implementations and
synthetic/real-infrastructure verification of their safety boundaries. They are
**not** `build_pass` or `done`, because OQ-SMP-1 has not supplied the real
company/vendor inventory, member exports, purchased capacities, per-organization
Admin/Analytics keys, approved canary address, or immediate VendorAccount
confirmation. Their mandatory real operations and resulting reconciliations
remain externally gated. This is an operator dependency, not an unfinished
implementation track, and it is reported as two separate `blocked` events.

The final post-integration Task 24 gate passed. The command, database, Compose,
Keycloak, mutation, and cleanup evidence is recorded below.

## Story status and commits

| Story | Status | Implementation commits |
|---|---|---|
| US-001 | Done | `488ce23`, `932711f`, `5d58ac7`, `699c364`, `0888bf6`, `703bcc0`, `c35902d`, `ea67596`, `e67c893`, `3fd4fbd`, `8f74b58`, `346e309` |
| US-002 | Done | `b622014`, `abd986d`, `69cb575`, `ace6278`, `6aa0d6c`, `3b0babe`, `cbbb286`, `8b068f3`, `1f7a285`, `d5a8783`, `01e0e4b`, `cf4e121`, `8279c64`, `8a64953`, `c7497f5`, `c00a25f`, `1e0bb58`, `edf694a`, `5c541f3`, `4cbb96c`, `15e376c`, `49a6d34`, `2eb11ae`, `3b4a586`, `18f802c`, `2f51e2f` |
| US-003 | Done | `1df1c2c` |
| US-004 | Done | `db7b212`, `b922d54` |
| US-005 | Done | `c6daf92`, `a0dca53` |
| US-006 | Done | `aa59f8b`, `543ae2e` |
| US-007 | Implementation approved; external operation blocked | `3d6e96d`, `f417396`, `fbf0b5c`, `aace62f`, `6207cb1`, `a0dca53` |
| US-008 | Done | `543ae2e`, `a0dca53` |
| US-046 | Done | `0eac04e`, `3ea8cca` |
| US-054 | Implementation approved; external operation blocked | `446f5ae`, `ec34623`, `cc3d4fb`, `5459679`, `7305bba`, `7c0b0cb`, `4a0fe4a`, `688f871`, `a0dca53` |

Shared post-integration fixture-limit corrections are in `3ea8cca` (US-046)
and `b06b780` (US-002/006/007/008). Lifecycle/synchronization commits include
`525c464`, `de9c06c`, `ea69ec9`, `8d6731b`, `3efce04`, `564f0af`, and
`458336d`; generated tracking remains owned by the Nous feedback loop.

## Acceptance criteria evidence

### US-001 — reproducible monorepo and design-token baseline

| AC | Evidence |
|---|---|
| AC1 | `rtk pnpm type-check` exercised the web app and the config, contracts, DB, domain, and UI workspaces. A clean `pnpm install --frozen-lockfile` established the committed `pnpm-lock.yaml`; root Turbo commands then resolved without the original `turbo: command not found` failure. |
| AC2 | `rtk pnpm check` ran type-check, flat-config lint, workspace tests, and `next build --webpack`; the exact workspace scripts and Turbo graph passed. |
| AC3 | `rtk pnpm --filter smp-web lint:ds` verified Tailwind 4 token parity, StatusPill single ownership, hardcoded color/string rejection, canonical 3/4/6/8-digit color parsing, and the Lucide allowlist. Token generation and parity checks were idempotent. |
| Adversarial case | Clean/frozen dependency installation followed by production build; mutation fixtures reject selector/declaration ownership violations, malformed colors, external semantic CSS, and raw RGB/HSL literals. |

### US-002 — Docker Compose runtime, CI migrations, and backup/restore

| AC | Evidence |
|---|---|
| AC1 | The isolated Compose project built the app and worker, then reported Postgres, Keycloak, app, worker, and SMTP relay healthy. External and in-container app probes returned exactly `{"status":"ok","database":"reachable"}`; the worker heartbeat was at most 60 seconds old. Unrelated local port occupancy was isolated by changing only published host ports to 18180/15432/13000. The exact project, network, and volumes were removed afterward. |
| AC2 | Root type-check/lint/test/build passed. The committed-migration runner applies a checksum-verified chain as `ledger_owner`; verification and parity exercise the least-privilege `ledger_app` runtime contract against disposable PostgreSQL databases. |
| AC3 | The production backup image and 83-check Bats matrix verify encrypted custom dumps, signed manifests, private/no-follow staging, endpoint and cluster identity pinning, guarded restore authority, failure finalization, concurrency locks, tamper rejection, and restore into a replacement PostgreSQL cluster. The operator procedure is documented in `docs/runbooks/backup-restore.md`. |
| Adversarial case | A real stopped PostgreSQL container makes the app health route return 503 without leaking error details; worker startup/heartbeat failure is non-zero and restartable. Restore-path mutations proved missing finalization and forged direct-entrypoint authority are detected. |

### US-003 — schema and database-enforced register integrity

| AC | Evidence |
|---|---|
| AC1 | `rtk pnpm --filter @smp/db test` plus DB type-check verify exactly 26 Drizzle/physical domain tables and the sorted, checksum-validated committed migration chain. |
| AC2 | Real PostgreSQL tests verify `btree_gist`, the half-open no-overlap exclusion, deferred INSERT/UPDATE contiguity trigger, pending-assignment partial uniqueness, `source_request_id` uniqueness, and exact function/table/column ACLs. |
| AC3 | Tests executed as `ledger_app` prove `AuditLog` UPDATE and DELETE are denied and detect dangerous role, membership, schema, table, column, function, or migration-ledger drift. |
| AC4 | The DB suite passed 10 files/91 tests covering overlap, adjacency, commit-time gaps, illegal append-only updates/deletes, tenant-scoped audited revocation, rollback paths, temp-table shadowing, and cleanup faults. |
| AC5 | Real SQL replay verifies deterministic disabled system actor and the three SystemSetting defaults without overwriting an operator-customized value. |
| Adversarial case | Explicit overlap, gap, illegal-column UPDATE, raw DELETE, and append-only audit mutations fail under the application role. |

### US-004 — Keycloak OIDC identity and privileged TOTP

| AC | Evidence |
|---|---|
| AC1 | Real Compose/Playwright authorization-code OIDC against realm `corporativo`, with S256 and conditional `platform-admin` OTP. Real PostgreSQL tests prove verified-email first-login CAS linking, `last_login_at`, atomic sanitized audit, race handling, and ambiguous-email rejection. |
| AC2 | Employee, approver, company-finance, central-finance, and group-admin journeys land on the exact navigation-registry routes with deterministic precedence and no Keycloak business-role authorization. |
| AC3 | Ledger renders no password/TOTP fields. Public screens have no authenticated chrome. A least-privilege Keycloak service account queries retained `LOGIN_ERROR` evidence after restart; Ledger stores only the OIDC/session outcomes it observes. |
| AC4 | A pre-authenticated non-admin promoted to `platform-admin` has the live session revoked and must enroll/use OTP before obtaining a new Ledger session. Real Keycloak tests cover add/remove membership, disabled-user denial, admin-without-OTP denial, unrelated-admin 403, and revocation. |
| Adversarial case | The locked Compose suite passed 11/11. Wrong, disabled, out-of-scope, and privileged-without-TOTP identities cannot obtain a privileged session. |

### US-005 — server-side RBAC and company isolation

| AC | Evidence |
|---|---|
| AC1 | Real PostgreSQL company-A/company-B tests resolve fresh global/company grants using `CURRENT_DATE`; `companyScope` emits a real Drizzle `company_id` predicate. Direct DB imports are statically restricted to the repository/transaction seam. |
| AC2 | Exact non-hierarchical capability-matrix tests cover the five platform roles plus employee; viewer is read-only and employee is requester-scoped. Sanitized 401/403 denials create Ledger-owned audit evidence. |
| AC3 | Generated role/default-route equality covers all 28 navigation-map screens. Proxy, authenticated layout, sidebar filtering, wrong-role, and unknown-role cases fail closed. |
| Adversarial case | Company A cannot read or write company B, viewer cannot mutate, unknown roles receive no access, and only an explicit global cross-company capability can omit the company predicate. |

### US-006 — responsive shell and bilingual locale

| AC | Evidence |
|---|---|
| AC1 | Real Keycloak Playwright and component tests verify the DEC-SMP-012 rail, exact generated sections, capability-filtered links, orange active state, mobile sheet, tablet icon rail, desktop labels, contextual header, scoped dynamic breadcrumbs, selector, and logout. |
| AC2 | Catalog-equality tests, real PostgreSQL locale persistence, and browser journeys verify structurally complete `es-EC`/`en-US`, persisted next-render selection, translated navigation, visible focus, and scoped dynamic labels. |
| AC3 | UI suites verify the single 12-state StatusPill palette, FreshnessLabel, MoneyText/data-display primitives, app shell, and accessibility contracts through design tokens. |
| Adversarial case | The final Keycloak Playwright suite passed 15/15, including locale switch/reload persistence, focus visibility, exact breadcrumbs, public chrome exclusion, and out-of-scope denial. |

### US-007 — secure go-live import implementation

| AC | Implementation evidence | Mandatory real evidence |
|---|---|---|
| AC1 | Exact CSV contracts reject malformed rows, duplicate identifiers, credential columns, conflicting contacts, and unknown references. Dry-run is no-write; deterministic natural keys and transaction isolation make identical replays create zero new rows. | **BLOCKED:** the final 30-company CSV is absent. |
| AC2 | Real PostgreSQL integration tests materialize Person, system LicenseRequest (`active`, `importación inicial`), initial transition, imported LicenseAssignment, and system audit atomically. | **BLOCKED:** final exported members and organization mapping are absent. |
| AC3 | Tests assert post-import integrity, exact created/reconciled counts, rollback, fixed-seed order independence, and two concurrent identical imports converging idempotently through a transaction-scoped advisory lock. | **BLOCKED:** real console-member reconciliation and zero delta cannot be signed off. |
| AC4 | Synthetic capacity and credential manifests validate one effective-dated row per natural key. XChaCha20-Poly1305 envelope encryption uses a private mounted KEK; Compose UID/GID/mode and actual Node 22 Alpine read/no-write behavior are verified. | **BLOCKED:** purchased capacities, per-org inventory, and Admin/Analytics credentials are absent. |
| Adversarial case | Focused real-DB/container tests reject symlinks, non-regular KEKs, wrong roots/modes/ownership, manifest/key conflicts, dirty destinations, partial inputs, and secret leakage. Repeated and concurrent imports produce exact zero deltas. |

The base Compose runtime does not require import secrets. Real imports opt into
`infra/docker-compose.import.yml`, with runtime environment values kept in an
ignored private file. The production KEK loader constrains an approved root,
walks path components without following symlinks, requires a regular file with
exact `0400`/`0440` permissions, uses `O_NOFOLLOW`, sanitizes errors, closes the
descriptor, and defaults to `/run/ledger-secrets`.

### US-008 — immutable audit trail and viewer

| AC | Evidence |
|---|---|
| AC1 | Structural action enforcement plus real PostgreSQL transaction tests prove every current Server Action reaches `withAudit` on all executable paths; mutation and audit commit atomically with recursive secret redaction. |
| AC2 | Real query integration, accessibility tests, and Keycloak browser journeys cover loading/error/empty/populated states, stable 50-row cursors, date/company/actor/action/entity filters, safe diff rendering, actor note, keyboard activation, and focus return. |
| AC3 | `ledger_app` cannot UPDATE/DELETE AuditLog. Locale and OIDC mutations emit immutable sanitized rows with derived company scope; null actor/global scope remain representable. |
| Adversarial case | The structural checker rejects conditional, unreachable, aliased, shadowed, and fake audit calls. Forced audit/domain failures roll back the other write; wrong role cannot view audit and HTML is not injected. |

### US-046 — pg-boss schedules and durable execution

| AC | Evidence |
|---|---|
| AC1 | Real PostgreSQL pg-boss tests verify all five exact UTC schedules, documented America/Guayaquil equivalents, fail-closed business calendar, queue/worker/schedule startup, and instance readiness degradation on scheduler-permission failure. |
| AC2 | Real retry/alert tests verify credential and stale-sync classifications, AlertRule-gated creation, concurrent 15-minute-bucket deduplication, explicit missing-rule/report failures, and durable claim/result replay across runtimes. |
| AC3 | Structured-log tests require job name/id, attempt, exact timestamps, duration, status, processed count, and sanitized error code. |
| Adversarial case | Reusing the same job key across two runtimes executes once and replays the stored result; forced scheduler, credential, sync, and alert-report failures cannot die silently. Worker 25/25 and domain 8/8 tests plus the production image build passed. |

### US-054 — safe Anthropic probe implementation

| AC | Implementation evidence | Mandatory real evidence |
|---|---|---|
| AC1 | The harness resolves and separates every Admin/Analytics key before the first request, runs all reads before any invite, validates pagination/cost shapes, constrains one-day probes, redacts raw bodies/PII/IDs/secrets, records allowlisted salted-HMAC evidence, and binds invite authorization to the provider-reported organization. Recovery checkpoints are private, atomic, organization-isolated, and preserve uncertain/manual-review states. Synthetic contract suite: 67/67. | **BLOCKED:** per-org keys, approved canary, mutation authorization, and immediate VendorAccount confirmation are absent; no real Anthropic call was made. |
| AC2 | Sanitized scope notes in `docs/spikes/US-054-anthropic-api-probe.md` reconcile documented provider behavior with US-018/US-026 assumptions, including pagination, headers, decimal cost data, and deleted-user null-email handling. | **BLOCKED:** provider-run artifacts cannot be reviewed or accepted until AC1's authorized real per-org executions occur. |
| Adversarial case | Tests reject equal/missing keys, wrong organization binding, missing authorization, invalid create responses, unsafe paths/symlinks, cleanup ambiguity, output/checkpoint collisions, and secret/identifier persistence. Manual-review precedence exits non-zero and cannot be overwritten by a later state. |

## Mutation evidence

The project threshold is a diff-scoped score of at least 80% on
effectiveness-critical changes; equivalent survivors require an adjacent
annotation and reviewer sign-off.

| Scope | Result |
|---|---|
| US-003 register integrity | 4/4 mutants killed; 100%; no survivors. |
| Core authorization/audit gate | Independently approved at 99.63%: 270 considered, 263 killed, 6 timed out, 1 genuine adjacent-annotated equivalent, and 0 uncovered/errors. Static route-policy and audit allowlist initialization remained in scope. |
| US-007 import/KEK boundary | 49 killed of 53, 92.45% overall; KEK loader 92.31%; advisory-lock logic 100%; zero no-coverage/timeouts/errors. Four survivors are three reviewer-approved equivalent defenses: redundant root/intermediate symlink predicates already enforced by `lstat`, and the final symlink precheck independently enforced by `O_NOFOLLOW`; each is annotated adjacent to the code. |
| US-054 probe safety boundary | Independently approved at 100%: 1,057 considered, 1,049 killed, 8 timed out, and 0 survived/uncovered/errors across the complete probe safety implementation, runtime, redaction, and schemas. Four narrowly scoped ignored mutants have adjacent reviewer-approved equivalence explanations. |
| Infrastructure reconciler | 7/7 mutants killed; 100%. |
| Sprint-wide mutation execution | The first broad whole-repository configuration ran 4,096 mutants and failed at 29.49% because it mutated outside the §3 diff-critical set. Corrected component gates above pass. A later experiment to mutate the entire real-PostgreSQL import transaction was stopped: killed mutants can abort Vitest before Testcontainers teardown, causing unbounded disposable-container accumulation. The accepted US-007 mutation scope remains the focused safety boundary above; full transaction behavior is instead proven by the 31/31 real-PostgreSQL/crypto integration suite. |

## Database migration ledger

Migrations remain append-only. SHA-256 values are calculated from the committed
files on this branch.

| Migration | SHA-256 |
|---|---|
| `V20251002145723__init_schema.sql` | `b536473640f6efa7538e62b124bf934a765c111984cf8f6f60398d4950234ed2` |
| `V20260725180000__core_schema_register_integrity.sql` | `61b9d8aaecf4be96f9abf3e53d3d8d8c9632eaa73a5dd0157e2ae3526e608bb2` |
| `V20260725180001__system_settings.sql` | `a72ccf0fbc8711693bbdbd6350538d863c207bfbcba843f25a5c2d919bf06967` |
| `V20260725180002__pgboss_schema_37.sql` | `08fcb42e1dbcbe399b4ded30fd70c2f259d71cfc45f96a7b370ec36858703873` |
| `V20260726002000__vendor_import_natural_keys.sql` | `a817682a828cfccfc3783d5f7b6142c351a3671c3406a598253ddca3c26b3c0e` |

The final isolated real-PostgreSQL gate applied all five committed migrations
and verified all five checksums, 26 application tables, 257 columns, 70 foreign
keys, two append-only triggers, exact `ledger_app` grants, and
migration-versus-Drizzle parity.

## Compose, database, and Keycloak evidence

| Gate | Evidence |
|---|---|
| Compose images/config | Both production images built. Base and backup-profile configuration, 10/10 Compose role/config tests, and isolated five-service runtime passed. Import credentials are an optional overlay and are not required for normal startup. |
| PostgreSQL | Postgres became healthy; app health reported `database: reachable`; worker heartbeat was fresh. Real integration suites exercised `ledger_owner`, `ledger_app`, pg-boss, import concurrency, and append-only denial. |
| Keycloak | Keycloak became healthy and retained events across restart. Real admin integration passed 5/5; the locked authentication browser suite passed 11/11, and the integrated shell/audit suite passed 15/15. |
| App/worker failure behavior | Stopped/unreachable PostgreSQL makes app health fail with sanitized 503 and worker readiness/lifecycle fail rather than reporting success. |
| Final post-integration Compose rehearsal | Isolated project `ledger-sprint1-final` used host ports 15432/18180/13000. Postgres, Keycloak, app, worker, and SMTP relay became healthy. Stopping Postgres produced sanitized app 503 and an unhealthy/restarting worker; both recovered automatically after restart. The exact project, network, and two disposable volumes were removed afterward. |
| Final migration apply/verify/parity | Five migrations applied; 5/5 checksums, 26 tables, 257 columns, 70 foreign keys, two append-only triggers, exact least-privilege grants, and Drizzle parity passed. Credentials were not printed. |
| Final Keycloak Playwright | The final complete rerun passed 15/15. |

## Sprint-wide Task 24 command gate

| Command | Result |
|---|---|
| `rtk pnpm type-check` | Passed, 7/7 Turbo tasks plus the probe type-check. |
| `rtk pnpm lint` | Passed. |
| `rtk pnpm lint:tests` | Passed: zero owned-code mocks and zero assertion-free tests. |
| `rtk pnpm test` | The full suite passed after integration (enforcement, feedback-order, 11 infrastructure tests, DB 97/97, worker 25/25, web 225/225, 10/10 Turbo tasks). After the final assurance changes, bounded affected-path reruns passed: probe 67/67, domain authorization 5/5, web authorization 22/22, and US-007 real-PostgreSQL/crypto 31/31. |
| `rtk pnpm build` | Passed, 7/7 tasks. |
| Mutation component gates | Passed and independently reviewed: core 99.63%, focused US-007 92.45%, full probe safety 100%, infrastructure 7/7. The monolithic wrapper was not repeated after diagnosing the unsafe Testcontainers-per-mutant teardown interaction described above. |
| `rtk pnpm validate:routes` | Passed, 28/28 route contracts. |
| `rtk pnpm validate:sidebar` | Passed; generated sidebar files are in sync. |
| Compose build/start/health/failure/cleanup | Passed in isolated project `ledger-sprint1-final`; both production images built, all five services became healthy, database loss/recovery behaved safely, and the exact disposable project was removed. |
| `rtk pnpm --filter @smp/db db:migrate` | Passed; all five committed migrations applied. |
| `rtk pnpm --filter @smp/db db:verify` | Passed; five checksums, 26 tables, two append-only triggers, and exact runtime grants verified. |
| `rtk pnpm --filter @smp/db db:parity` | Passed; 26 tables, 257 columns, and 70 foreign keys matched. |

## Decisions, deviations, and reconciliation

- DEC-SMP-017/CHG-001 resolves `company_id` as the Ledger tenant boundary,
  VendorAccount as business data rather than authorization scope, Auth.js +
  Keycloak identity with Ledger-DB authorization, Keycloak-owned password/TOTP
  evidence, `ledger_owner` migrations with `ledger_app` runtime, and
  Docker Compose/VPS deployment.
- The generated in-app credential form was reconciled to redirect-based OIDC:
  Keycloak, not Ledger, renders and verifies password/TOTP.
- US-001 initially separated the workspace baseline from its token-layer AC;
  the later token commits and adversarial enforcement completed AC3.
- US-002's early image-pull and host-port blockers were superseded by a complete
  isolated five-service run. The published-port override did not modify
  application topology or container contracts.
- US-002 backup/restore evidence was repeatedly superseded where adversarial
  review exposed unsafe assumptions. The accepted protocol uses signed source
  provenance, target identity confirmation, private pinned staging,
  single-session/locked authority, and unconditional finalization.
- US-007 separates the default Compose stack from an explicitly opted-in import
  overlay, keeps private manifests/runtime values out of Git, and refuses to use
  synthetic templates as operational evidence.
- US-054 performs no live-network call in CI and never sends an invite without
  explicit organization-bound authorization and an approved canary.

## External operator gates

### US-007 / OQ-SMP-1

Required from the primary owner through approved private/secret channels:

- final 30-company CSV;
- per-organization inventory;
- exported member lists;
- purchased capacity by organization and license type;
- per-organization Admin and Analytics credentials.

After delivery, run the production preflight/import, verify duplicate execution
creates zero new rows, confirm both member and capacity deltas are zero, review
the sanitized reconciliation report, then append AC verification,
`build_pass`, and `done`. Until then, US-007 remains `blocked`, not deferred or
done.

### US-054 / OQ-SMP-1

Required from the primary owner:

- per-organization Admin and Analytics keys with required scopes;
- approved invite-canary address;
- explicit invite mutation authorization;
- immediate VendorAccount confirmation for each mutation.

After delivery, execute all read probes per organization before any canary,
review sanitized artifacts and recovery state, file/accept assumption deltas,
then append AC verification, `build_pass`, and `done`. Until then, US-054
remains `blocked`, not deferred or done.

No private inventory, member list, key, ciphertext derived from a real key, raw
provider response, full identifier, or unredacted reconciliation artifact is
included in this repository or feedback ledger.
