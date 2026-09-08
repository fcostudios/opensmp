# CHG-058 Faster Child Mutation Workflow Design

## Context

US-064 proved that CHG-057 fixed stop-at-first campaign behavior: the story closed with two cold campaigns totaling nine minutes. It also exposed three remaining costs. The initial readiness estimate predicted six files and one shard but implementation reached 33 files and initially routed 13 shards; three first-contact shards scored only 20–31% because their mutation feedback arrived after the code tasks; and readiness, design, and planning ceremony consumed roughly 50 minutes for a canonical partition child.

CHG-058 makes the next child honest before implementation and mutation-ready at every task boundary. It does not change product behavior or the final evidence contract.

## Goals

1. Calculate readiness file and shard expectations from an explicit planned scope using the production mutation router.
2. Require every implementation task to preview all mutation shards it touched and repair survivors before the next task.
3. Let a canonical partition child reuse an approved parent design and proceed from readiness directly to planning.
4. Remove the remaining US-017-specific environment dependency from the shared PostgreSQL fixture.
5. Reassess US-065 and US-066 as ready at the calibrated 224-minute story-point rate.

## Non-goals

- Changing the final cold-campaign threshold, evidence schema, or single-last-campaign rule.
- Making previews authoritative or allowing them to emit `test_report`.
- Creating another mutation routing table or readiness-only shard heuristic.
- Amending generated US-065 or US-066 story specifications.
- Broadening PostgreSQL fixture access beyond one complete, unambiguous story-scoped owner/app URL pair.

## Planned-scope calculation

`scripts/mutation-scope.mjs` gains a pure exported calculator and a CLI mode:

```text
node scripts/mutation-scope.mjs --planned-scope <repo-relative-path>...
```

The result is canonical JSON:

```ts
interface PlannedMutationScope {
  expected_changed_files: number;
  expected_mutation_shards: number;
  files: readonly string[];
  shards: readonly {
    id: string;
    kind: string;
    sources: readonly string[];
    testFiles: readonly string[];
    mutate: readonly string[];
  }[];
}
```

The calculator accepts current repository files rather than a Git diff. It converts each planned mutatable source to its complete current line range, preserves reviewed static ranges such as Vitest configuration targets, then reuses the existing mutatable filtering, accountable-test routing, exact-adapter classification, and shard grouping. Test and documentation paths count toward `expected_changed_files` but do not create mutation targets.

This mode performs no Stryker execution, database runtime-profile probe, cache lookup or write, generated shard write, readiness edit, mutation report, or performance evidence write. It is mutually exclusive with `--preflight`, `MUTATION_SHARD`, and campaign execution.

The input fails closed unless it is a non-empty set of unique, canonical, repository-relative POSIX paths. Absolute paths, traversal, NULs, duplicates, directories, missing or unreadable files, generated artifacts, unknown flags, and flags placed after planned paths are rejected. A planned mutatable source without an existing accountable route is rejected rather than counted as zero. A brand-new production module therefore cannot be sized until its path and accountable test route exist; the assessment must retain that uncertainty or plan the module inside an already accountable boundary.

## Per-task preview contract

Every implementation task in a new plan ends with these steps after its focused tests are green:

1. Run ordinary mutation preflight against the task’s committed candidate.
2. Intersect the preflight shards’ `sources` with the production sources touched by the task.
3. Run each intersecting shard once with its exact discovered ID:

   ```text
   MUTATION_SHARD=<post-task-shard-id> pnpm test:mutation
   ```

4. Repair all genuine survivors and rerun the affected preview before completing task review.

Shard IDs are content-derived and must be discovered after the task; plans never hardcode them. A task with no intersecting shard records that result and proceeds. Previews stay non-authoritative, do not require cache clearing, do not emit `test_report`, and do not write authoritative performance evidence. They do not replace adversarial verification, `pnpm check`, or the one cache-cleared diff-scoped campaign that remains the last executable verification before evidence closure.

The runner does not gain task-state tracking. The plan names each task’s production-source set, and the executor applies the intersection rule using the existing preflight output.

## Partition-child design inheritance

A canonical partition child may omit its own design document only when all of the following are true:

- the parent partition and official child ID are approved;
- an approved parent design or delivery-plan design section explicitly covers that child’s allocated acceptance criteria, outcome, stable interfaces, tenant and authorization boundary, lifecycle or concurrency boundary, non-goals, and verification strategy;
- the child readiness assessment cites those parent artifacts and introduces no unresolved material uncertainty or scope outside them; and
- the child implementation plan cites the exact parent artifact path and section as its `Spec` authority.

Otherwise the child follows the normal readiness → design → plan sequence. The omission is inheritance, not a waiver: the plan must still contain complete executable detail.

For US-065 and US-066, the approved US-019 partition in `docs/readiness/US-019.json`, DEC-SMP-021/CHG-054 canonical child allocation, the generated child stories, and the US-019 section of `docs/superpowers/plans/2026-08-02-sprint-3-delivery.md` form the inherited parent-design authority. CHG-058 records that binding in `WORK_READINESS.md`; neither child gets a duplicate design commit.

## US-065 and US-066 reassessment

Each reassessment starts with an explicit planned path list derived from its story, inherited parent design, and existing implementation seams. The new planned-scope mode calculates both readiness signals from that exact list:

- `expected_changed_files` equals the canonical unique path count.
- `expected_mutation_shards` equals the calculator’s shard count.

Both stories retain one cohesive outcome and three acceptance criteria, resolve their US-063 dependency, and record any completed sibling ordering needed by the parent partition. US-065 also records US-064 as completed prerequisite evidence for the generic-failure boundary. Each estimate totals 224 minutes, the current Nous calibration for one story point and below the 320-minute execution cap. The phase allocation must reserve no more than ten minutes from readiness approval to the committed plan so US-065 can satisfy CHG-058’s acceptance measurement.

Changing either readiness payload resets its approval. Implementation cannot start until Francisco approves the new exact digest-bound decisions.

## Shared PostgreSQL mutation fixture

`packages/db/src/testing/postgres-container.ts` replaces direct reads of `US017_MUTATION_DATABASE_URL` and `US017_MUTATION_DATABASE_ADMIN_URL` with a small complete-pair selector.

The selector enumerates only exact keys matching:

```text
US<digits>_MUTATION_DATABASE_URL
US<digits>_MUTATION_DATABASE_ADMIN_URL
```

It groups values by the exact `US<digits>` prefix and applies this closed decision table:

- no story-scoped keys: use the normal Testcontainers path;
- one complete owner/app pair: clone the template and expose both sandbox URLs under that same prefix;
- any incomplete pair: reject before connecting;
- more than one complete pair: reject as ambiguous.

US-017 remains an ordinary valid prefix. Selection never picks the lexicographically first pair and never silently combines prefixes. The existing isolated clone, independent database name, idempotent cleanup, role separation, and no-live-container mutation path remain unchanged.

## Testing

`scripts/test-mutation-scope.mjs` exercises the planned-scope calculator through real controlled repositories and literal expectations. Tests cover canonical ordering, exact file and shard counts, equivalence with normal grouping for identical full-file targets, static ranges, non-mutatable files, unrouted sources, invalid paths, conflicting CLI modes, and the absence of reports or performance artifacts. Existing selector-preview tests remain authoritative for one-shard execution; a new two-shard fixture proves every task-selected preview can run separately while neither becomes authoritative.

`packages/db/src/testing/postgres-container.test.ts` adds strong behavior tests for complete US-065 and US-066 pairs, incomplete app-only and owner-only pairs, multiple complete pairs, independent database naming, and real clone cleanup. Tests exercise the owned fixture rather than asserting environment-source text.

US-065 and US-066 readiness checks validate the calculated signals, 224-minute totals, resolved dependencies, and new digest bindings. The CHG finishes with adversarial review, `pnpm check`, task previews for its touched source shards, then one cache-cleared authoritative diff-scoped campaign last.

## Acceptance measurement

CHG-058 itself demonstrates all four outcomes. Its downstream acceptance is measured on US-065:

- the first cold campaign has no shard below 80%;
- no more than two cold campaigns occur;
- readiness approval to committed plan is at most ten minutes;
- at most three documentation commits precede implementation; and
- total actual time is at most 1.5 times the reassessed estimate.

`nous_trace.py story timeline US-065` remains the execution-shape record. Preview campaigns emit no timeline `test_report` entries.
