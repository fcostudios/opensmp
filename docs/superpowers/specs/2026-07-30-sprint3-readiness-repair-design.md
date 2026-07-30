# Sprint 3 Readiness Repair Design

## Status

Approved in conversation on 2026-07-30.

## Goal

Make Ledger safe to start Sprint 3 by restoring a fully green hosted CI
pipeline, executing every gate skipped by fail-fast behavior, correcting the
US-025/US-018 dependency and provider-contract requirements at the Nous source,
and advancing the generated plan to `current_sprint: sprint-3` without falsely
claiming that the externally blocked US-054 live Anthropic probe ran.

## Current evidence

Hosted CI run `30527693239` at merged Sprint 2 commit `8f72de6` failed in four
portable assertions:

1. Two Spanish date assertions depend on whether the host ICU emits ordinary
   spaces or non-breaking spaces around `p. m.`.
2. One Docker Compose assertion requires
   `bind.create_host_path: false`, although the Linux Compose serializer omits
   the default and emits `bind: {}`.
3. The Windows portability job attempts an invalid pnpm child-process
   invocation and exits with `spawn EINVAL`.

The `verify` failure skipped the production build, route/sidebar checks,
migration apply, migrated-schema verification, and migration parity. The job
dependency graph then skipped the critical-path mutation and Sprint 2
Compose/Keycloak E2E jobs.

Sprint 2 implementation evidence is complete and append-only revalidated, but
the generated `docs/stories/SPRINT_PLAN.md` remains stale at
`current_sprint: sprint-2`. US-054 remains blocked because no private
per-organization Admin/Analytics credentials, approved invite canary, explicit
mutation authorization, or immediate VendorAccount confirmation are
available.

US-018 says its connector follows capability semantics from US-025, but the
canonical dependency graph currently schedules US-018 before US-025. The
repository testing policy also requires every third-party mock to be backed by
a Pact contract, while no Pact dependency or Anthropic contract suite exists.

## Decision

Use a controlled Sprint 3 start:

- US-054 live execution remains visibly `blocked_external`; it is not marked
  `done`.
- Sprint 2 remains terminally `closed_with_deferrals`.
- Missing US-054 credentials do not block key-independent Sprint 3 work.
- US-054 is a hard go-live/terminal-acceptance gate for the real Anthropic
  connector and automated provider flows.
- CI, dependency, Pact, and Nous projection repairs are hard Sprint 3 start
  gates.

Skipping directly to Sprint 4 is rejected because Sprint 3 contains useful
key-independent work and defines the connector contracts that later sprints
consume. Removing live provider verification is rejected because it would
permit automation without real credential-scope, organization-binding,
pagination, rate-limit, invite-create, and invite-cleanup evidence.

## Repair architecture

### 1. Portable CI assertions

Date tests will compare a normalized display value that maps Unicode
non-breaking and narrow non-breaking spaces to ordinary spaces. The semantic
oracle remains exact after normalization: locale, Ecuador instant, date, time,
and day-boundary behavior must still match.

The Compose test will assert the security contract rather than a
serializer-specific default representation:

- exact source and target paths;
- bind mount type;
- read-only access;
- `create_host_path` must not be `true`.

The pnpm process resolver will distinguish a JavaScript package-manager CLI
from a Windows command shim. JavaScript entrypoints execute through
`process.execPath`; Windows shims execute through the platform-supported command
path. Tests will cover both resolutions and actual bounded execution on
Windows and POSIX.

### 2. Fail-fast CI proof

The existing order remains:

```text
process portability
        +
verify: type → lint → test → build → routes/sidebar
       → owner migration → runtime verification → parity
        ↓
critical-path mutation
        ↓
Sprint 2 Compose/Keycloak E2E
```

No skipped downstream job counts as evidence. Acceptance requires one hosted
run in which every required job executes and succeeds.

### 3. US-054 external deferral

Append a new change decision without rewriting prior evidence:

- classify US-054 as `blocked_external`;
- cite the missing Admin and Analytics keys, approved canary, explicit invite
  authorization, and immediate VendorAccount confirmation;
- keep Sprint 2 terminal through `closed_with_deferrals`;
- state that Sprint 3 may start but US-018, US-019, US-026, and US-030 cannot
  receive live-provider terminal acceptance until the authorized probe runs.

The live command remains operator-only. It must resolve secrets from a
gitignored manifest/environment, complete every read phase before any invite,
and keep invite mutation disabled unless all existing organization-bound
authorization gates pass.

### 4. Canonical Sprint 3 ordering

The canonical dependency becomes:

```text
US-025 Vendor accounts and capability descriptor
    ↓
US-018 Anthropic connector client
    ├── US-019 automated provisioning
    ├── US-026 analytics sync
    └── US-030 drift detection
```

The change is made in the Nous source of truth first. Generated story files,
indexes, assignments, and `SPRINT_PLAN.md` are regenerated; they are not
hand-edited.

The first key-independent Sprint 3 execution group is US-011, US-023, US-025,
and US-043. US-018 may begin after US-025 with synthetic Pact-backed
development, but its live-provider evidence stays blocked by US-054.

### 5. Anthropic Pact boundary

US-018 gains an explicit contract-test acceptance requirement. The consumer
contract covers:

- current-organization identity;
- member list and pagination;
- invite list/create/withdraw;
- Analytics user/activity/usage/cost pagination;
- endpoint-specific headers;
- separate Admin and Analytics credential families;
- rate-limit and retry-classification responses;
- sanitized error contracts and exact decimal cost strings.

Owned connector code is never mocked. Deterministic Pact provider fixtures
stand in only for the true Anthropic network boundary. Pact verification gates
CI before mutation and E2E. A passing Pact suite proves the checked contract,
not real key scopes or real provider operation; US-054 remains the latter
oracle.

The contract must encode the Sprint 1 probe corrections:

- no global beta header;
- no fictional invite dry-run;
- distinct key families;
- no raw credential, header, PII, or provider-identifier persistence;
- exact decimal cost handling;
- explicit null-email handling for deleted users.

### 6. Nous synchronization

Open a new CHG before changing generator-owned guidance. Feed these decisions
to Nous:

- Sprint 2 closed with the US-054 external deferral;
- `US-025 → US-018`;
- the Pact acceptance requirement;
- US-054 as the live-provider terminal gate;
- CI green evidence after all jobs execute.

Run the configured Nous synchronization and regenerate all owned projections.
Acceptance requires:

```yaml
current_sprint: sprint-3
```

The generated Sprint 2 story statuses must reflect terminal evidence, while
US-054 remains visibly deferred/blocked rather than falsely done.

## Error handling and safety

- CI portability tests may normalize representation differences only when the
  underlying semantic value remains exact.
- Compose assertions fail if a sensitive mount is writable, has the wrong
  source/target, or can create an absent host secret path.
- Child-process execution remains bounded, redacted, and process-tree safe on
  both Windows and POSIX.
- Nous synchronization runs in preview/check mode before applying generated
  changes and must reject unknown substrate input.
- No Anthropic credential, real identifier, raw provider body, canary address,
  or recovery artifact enters Git, CI logs, or `.nous-feedback.jsonl`.
- US-054 cannot transition to `done` without authorized real-provider evidence.

## Verification

Local repair gates:

```bash
pnpm --filter @smp/db exec vitest run src/parity-process.spec.ts
pnpm --filter smp-web exec vitest run \
  src/components/requests/request-record.test.tsx \
  src/components/requests/checklist-exceptions-list.test.tsx \
  src/modules/vendor-catalog/compose-credential-secrets.test.ts
pnpm type-check
pnpm lint
pnpm test
pnpm build
pnpm validate:routes
pnpm validate:sidebar
```

Hosted acceptance requires:

- both portability matrix jobs green;
- `verify` green through migration, schema verification, and parity;
- critical-path mutation job executed and green;
- Sprint 2 Compose/Keycloak E2E executed and green;
- no job skipped because of an upstream failure.

Planning acceptance requires:

- lifecycle/feedback validators green;
- generated artifacts synchronized with Nous;
- `current_sprint: sprint-3`;
- US-025 ordered before and blocking US-018;
- the Pact gate visible in US-018 and CI;
- US-054 visibly externally blocked with no false terminal event.

## Completion boundary

Sprint 3 is ready to start when the hosted pipeline and generated planning
artifacts meet the verification requirements above. The lack of Anthropic keys
remains an explicit operational blocker for live connector acceptance, not a
reason to postpone all Sprint 3 development or advance to Sprint 4.
