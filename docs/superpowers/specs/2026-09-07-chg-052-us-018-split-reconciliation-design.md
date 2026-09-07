# CHG-052 US-018 Split Reconciliation Design

## Context

US-059 through US-062 are tenant-only artifacts from the 2026-08-15 attempt to
partition US-018 under the former 120-minute ceiling. Nous never minted those
IDs. CHG-045 later established the canonical partition as US-056, US-057, and
US-058, and those three stories delivered all four US-018 acceptance criteria.

Executing either US-018's current 310-minute readiness assessment or any of the
four obsolete tenant IDs would duplicate shipped behavior and corrupt the work
ledger. CHG-052 therefore reconciles identity and evidence; it does not deliver
new connector behavior.

## Outcome

The readiness gate permanently refuses US-059, US-060, US-061, and US-062,
while preserving their historical files so the IDs cannot be re-minted with
different content. US-018 becomes a verification-only closure item. Its four
acceptance criteria are verified against the canonical child deliveries:

- AC1: US-056 transport, credential, rate-limit, and bounded-retry evidence.
- AC2: US-057 append-only sanitized observation evidence.
- AC3: US-058 neutral connector conformance and capability evidence.
- AC4: US-058 Pact-backed deterministic network-fixture evidence.

US-018 emits exactly one lifecycle start, four `ac_verify` events, one
`build_pass`, and one terminal `done`, all with ISO-8601 UTC timestamps. It
emits no implementation claims and changes no path under `apps/` or `packages/`.
Once projected into Nous, US-019 is unblocked by US-018's `dev_done` status.

## Readiness Representation

The readiness schema is closed and has no `superseded` decision. The four
obsolete artifacts therefore use its fail-closed representation:

- `decision` is `blocked`;
- the sole unresolved uncertainty says that CHG-052 permanently superseded the
  tenant-only ID with the named canonical child deliveries;
- the resolution is `null`, because no future work can make that ID executable;
- approval is digest-bound to an explicit human decision; and
- `controlling_change` names CHG-052 with relationship
  `readiness_governance`.

This retains the historical identity, makes `pnpm readiness:check -- US-059`
through `US-062` fail closed as intended, and prevents an agent from interpreting
an absent file as permission to recreate the ID.

## US-018 Reassessment

US-018 keeps one functional outcome and the four canonical AC identifiers, but
its scope becomes `contracts` and `docs`. The assessment declares zero routes,
zero implementation files, zero lifecycle boundaries, and zero mutation shards.
Its estimate covers evidence inspection, current-tree verification, independent
review, ledger emission, and integration only.

The readiness decision remains `ready` only after a new digest-bound human
decision under CHG-052. The previous 310-minute digest and approval cannot be
replayed after this material scope change.

## Verification and Closure

The controller verifies each child from committed primary evidence: its
readiness actuals, local feedback events, source commits, focused tests, and the
current full build. Evidence text cites those concrete sources rather than
claiming new implementation.

Because CHG-052 and reassessed US-018 both declare zero mutation shards, no cold
mutation campaign is required. At most one may run if evidence review finds a
real verification need. The full `pnpm check` run supplies the single
`build_pass`; no commit after that run may alter product or test behavior.

The terminal commit fills US-018 actuals honestly from this reconciliation
range and appends `done`. The feedback is then pulled into Nous and the rendered
US-018 timeline must show the required seven-event shape and `dev_done`.

## Rejected Approaches

### Implement the four tenant-only child IDs

Nous never minted them, and their behavior already exists under official
children. This would violate the stable work-ID rule and double-count delivery.

### Delete the obsolete readiness artifacts

Deletion erases why the IDs are invalid and makes later re-creation easier.
Fail-closed blocked artifacts preserve the tombstone and its controlling change.

### Mark the artifacts with a new `superseded` decision

That value is outside the closed schema and would require an unrelated tooling
change. `blocked` expresses non-executability without weakening validation.

### Reimplement or mutate US-018

The parent is an aggregate closure. Its child evidence and a current green build
are the appropriate oracles; new application code would be duplicate scope.
