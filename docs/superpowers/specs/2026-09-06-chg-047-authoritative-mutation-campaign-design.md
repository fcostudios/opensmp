# CHG-047 Authoritative Mutation Campaign and Review Calibration Design

## Context

US-057 completed within its total estimate but spent 148 review minutes against
20 estimated. It also ran four cold mutation campaigns; three became stale when
later review fixes changed scored source. Across the four readiness artifacts
with closed actuals when CHG-047 was filed, implementation represented 28% of
1,253 measured minutes and review represented 65%.

IMP-387 corrects the substrate-generated Definition of Done. CHG-047 is the
Ledger-side companion: it defines which mutation run is authoritative, records
its cost, and makes the observed review-to-implementation ratio available as an
opt-in estimate calibration without creating a new rejection rule.

## Outcome

Every new Ledger work item can be planned and closed using this sequence:

1. implement and run focused verification;
2. perform adversarial acceptance, quality, and security review;
3. commit every resulting fix;
4. clear the mutation cache and run one diff-scoped cold campaign;
5. make no further implementation commit; then record evidence and close.

The closure actuals may record the wall-clock cost of authoritative mutation
campaigns. Existing artifacts remain valid without that measurement.

## Architecture

### Authoritative campaign

`docs/dev-guide/WORK_READINESS.md` will define an authoritative cold campaign
as a cache-cleared invocation of the existing diff-scoped runner:

```bash
pnpm mutation:cache:clear
MUTATION_BASE_REF=<approved-authority-base> pnpm test:mutation
```

It runs once, after adversarial review and all resulting fixes are committed.
Any later implementation, test, dependency, configuration, runner, or tooling
commit invalidates the campaign because it changes evidence inputs. The
existing CHG-037 invalidation count and reason events remain unchanged.

`pnpm test:mutation:core` remains authoritative only when a CHG changes the
effectiveness-critical set itself, as CHG-040 and CHG-044 did. Ordinary stories
and changes use the diff-scoped runner.

The implementation plan for CHG-047 will demonstrate the reusable ordering:
all review and repair tasks precede a final executable mutation task. After
that task, only evidence recording and terminal closure are permitted.

### Optional mutation duration

The readiness `actuals` object gains an optional `mutation_minutes` property.
When present, it must be a non-negative integer representing the summed
wall-clock minutes of authoritative cold campaigns, including campaigns later
invalidated with reasons. It does not change `phase_minutes` arithmetic:
mutation work remains accounted for inside the phase in which it occurred, so
adding `mutation_minutes` to `total` would double-count time.

Both validation layers remain aligned:

- `docs/dev-guide/work-readiness.schema.json` accepts the optional property and
  validates it as a non-negative integer;
- `scripts/work-readiness/model.mjs` accepts the same optional property and
  rejects invalid values through the existing shape/type error categories.

Absence remains valid for every historical artifact and for future work whose
campaign cost was not captured. Terminal completion does not require the field,
and CHG-047 introduces no new readiness error code.

### Review calibration command

The root package gains:

```bash
pnpm readiness:calibrate -- <WORK-ID>
```

The command reads `docs/readiness/<WORK-ID>.json`, requires its existing
`estimate_minutes.implementation` to be a non-negative integer, and calculates:

```text
review = ceil(implementation * 65 / 28)
total = readiness + implementation + focused_verification + review + integration
```

It updates only `estimate_minutes.review`, `estimate_minutes.total`,
`readiness_payload_sha256`, and `approval.payload_sha256`. Because calibration
changes the approved payload, it resets approval to the explicit pending shape:
`status: pending`, with `approved_by` and `evidence` set to null. This prevents a
stale decision from appearing to authorize the recalibrated estimate.

The write reuses the readiness CLI's contained-path and atomic file-replacement
mechanism. Existing invocation, path, JSON, and integer error categories cover
failures; no new error code is added. Calibration is opt-in. Authors may edit
phase estimates manually before approval, and validation does not enforce the
65/28 ratio.

Calibration refuses completed artifacts because their actuals and approved
estimate form immutable historical evidence. It also refuses an active
implementation whose `started` or later implementation evidence follows the
selected approval; recalibration belongs before execution and requires a new
digest-bound decision.

## Data and control flow

```text
readiness artifact
      |
      v
readiness:calibrate ---- validate contained file and open lifecycle
      |                  compute ceil(implementation * 65 / 28)
      |                  recompute total and readiness digest
      v
pending recalibrated artifact ---- human digest-bound approval ---- execution
                                                                  |
review and fixes committed <--------------------------------------+
      |
cache clear + one diff-scoped cold campaign
      |
optional mutation_minutes + required invalidation reasons
      |
terminal evidence
```

## Testing strategy

Tests follow `docs/dev-guide/TESTING.md` and exercise owned code directly.

`scripts/test-work-readiness.mjs` will first receive failing cases for:

- a historical actuals object without `mutation_minutes` remaining valid;
- zero and positive `mutation_minutes` values passing;
- negative, fractional, null, and non-numeric values failing through existing
  validation errors;
- calibration rounding at representative implementation values;
- exact total recomputation while preserving the other four phase values;
- approval reset and digest recomputation;
- refusal to recalibrate completed or already-started work;
- atomic contained-file behavior using the existing real filesystem fixture.

Implementation follows only after those tests fail for the missing behavior.
The focused gates are `pnpm test:work-readiness` and
`pnpm test:enforcement`, followed by type-check, lint, and build. Independent
specification and quality reviews happen before the sole final cache-cleared,
diff-scoped mutation campaign.

## Expected implementation files

1. `docs/dev-guide/WORK_READINESS.md`
2. `docs/dev-guide/work-readiness.schema.json`
3. `scripts/work-readiness/model.mjs`
4. `scripts/work-readiness.mjs`
5. `scripts/test-work-readiness.mjs`
6. `package.json`

The readiness artifact, this design, the implementation plan, and append-only
feedback are governance evidence rather than implementation-scope files.

## Non-goals

- No change to the CHG-037 invalidation formula or event semantics.
- No new mandatory field for historical or future actuals.
- No new readiness rejection rule or error code.
- No change to the 320-minute work limit or 104-minute story-point calibration.
- No application or package runtime changes.
- No automatic mutation execution from the readiness CLI.
- No whole-critical-set campaign for ordinary diff-scoped work.
