# Commit Conventions — Traceability Required

Every commit on this repo **must** reference a user story (`US-NNN`) or
change request (`CHG-NNN`) somewhere in the commit message (subject or body).

This is enforced by `.githooks/commit-msg` — a client-side guard installed
via `infra/scripts/install-git-hooks.sh`. After traceability succeeds, the hook
also validates the exact staged index against the work-readiness gate. Tests,
production code, migrations, runtime configuration, hooks, and executable
tooling require approved `ready` evidence for every referenced work ID.

## Why

The Nous pipeline relates shipped code back to its owning spec. When a
commit has no `US-*` / `CHG-*` reference, the route, migration, or feature
it delivers becomes an **orphan** — visible in `nous_package.py drift`
as "WORKFLOW HOLE" with no owning story.

During Sprint 4-10 a handful of admin routes shipped off-book (e.g.,
`/admin/settings/kpis`, `/admin/settings/ideal-client`) because agents made
changes without linking to a US. CHG-021 cleaned those up retroactively;
this hook prevents a repeat.

## How to reference

Any of these work — put the reference anywhere in the message:

```
feat(sales): add activity log (US-013)
```

```
fix(api): correct funnel stage order

CHG-012 addresses the stage reordering request from the forecast review.
```

```
refactor(shell): extract nav-items generation

Part of US-129 landing page cleanup.
```

Multiple references are fine:

```
feat(forecast): lifecycle statuses (US-132, US-133, US-134 via CHG-009)
```

Every referenced ID is independently enforced. The example above is rejected
if even one of `US-132`, `US-133`, `US-134`, or `CHG-009` is missing its
approved readiness artifact or is `blocked` / `partition_required`. References
are case-insensitive and normalize to their official uppercase form, so
`us-132` and `US-132` have identical ownership requirements.

## Bootstrap an assessment before implementation

Assessment, design, plan, and feedback-only changes may be committed while
approval is pending. They do not authorize implementation:

```bash
pnpm readiness:init -- US-123
# Complete docs/readiness/US-123.json, obtain the digest-bound Nous decision,
# then validate it before staging implementation.
pnpm readiness:check -- US-123
git add docs/readiness/US-123.json .nous-feedback.jsonl
git commit -m "docs(US-123): approve work readiness"
```

The artifact and matching decision must be valid in the parent commit before
implementation is staged. Combining approval evidence and implementation in
one commit is rejected: the candidate commit cannot approve itself. For a
multi-ID implementation, every referenced ID must already be parent-authorized.

Parent authorization must also be current. A later `blocked` / `blocker`, a
45/90-minute checkpoint that says `blocked` or `partition_required`, an
effective terminal event, or a later readiness decision closes or supersedes
the selected approval. Resume only after committing a fresh digest-bound
decision and updating `approval.evidence` to that new unique decision.

A completed readiness artifact remains valid audit evidence for `check` and
`check-all` only when its terminal actuals are complete and internally
consistent. Its authorization is nevertheless inactive and cannot authorize
another implementation commit. Reusing the completed CHG-022 bootstrap reports
the stable `WR_BOOTSTRAP_EXPIRED` ownership error.

An implementation commit is validated against both states: its parent proves
prior authorization, while its candidate tree must remain fully valid and
active. The commit cannot change the canonical readiness payload or switch its
approval binding. It may update the digest-excluded `checkpoints` and `actuals`
fields only when their candidate lifecycle remains valid and authorization is
still active.

`.nous-feedback.jsonl` is byte-for-byte append-only on every commit, including
documentation-only commits. Never delete, reorder, reformat, or rewrite an
earlier record. Preserve the exact parent bytes and append complete JSON object
records ending in a newline. A truncated or partial appended line fails
`WR_FEEDBACK_HISTORY_MUTATED`. To recover before committing, restore the staged
history from `HEAD`, then append the new record again:

```bash
git show HEAD:.nous-feedback.jsonl > .nous-feedback.jsonl
# Append complete JSONL records; do not edit the restored prefix.
git add .nous-feedback.jsonl
```

The following implementation commit is rejected when `US-123` has no artifact,
has stale or missing approval evidence, or declares `partition_required`:

```bash
git add apps/web/src/app/example/page.tsx
git commit -m "feat(US-123): add example outcome"
# WR_READINESS_MISSING / WR_APPROVAL_REQUIRED / WR_WORK_NOT_READY /
# WR_APPROVAL_INACTIVE / WR_CANDIDATE_PAYLOAD_CHANGED
```

Fix the assessment or partition first, obtain a new digest-bound decision, and
then run:

```bash
pnpm readiness:check -- US-123
node scripts/work-readiness.mjs check-staged \
  --message-file "$(git rev-parse --git-path COMMIT_EDITMSG)"
git commit -m "feat(US-123): add example outcome"
```

The direct `check-staged` recovery command expects Git's canonical
`COMMIT_EDITMSG`; an arbitrary temporary message file is rejected. See
[`WORK_READINESS.md`](WORK_READINESS.md) for artifact fields, hard limits,
approval evidence, and outcome-based partitioning.

## Install

```bash
./infra/scripts/install-git-hooks.sh
```

Idempotent. Sets `core.hooksPath=.githooks` for this clone.

## Exempt commit types

The hook preserves the missing-ID traceability exemptions below, but still
invokes staged readiness whenever Git calls `commit-msg`. They are not
readiness exemptions: repository range validation still examines the
implementation they introduce, and unsupported merge topology fails closed.

| Type            | Example subject                  |
|-----------------|----------------------------------|
| Merge           | `Merge branch 'feature/xyz'`     |
| Revert          | `Revert "feat(..)"`              |
| Fixup / squash  | `fixup! ...` / `squash! ...`     |
| Release         | `chore(release): v1.4.0`         |

## Emergency bypass

For legitimate one-off emergencies (prod incident, revert-not-yet-in-history):

```bash
COMMIT_MSG_NO_US=1 git commit ...
```

The bypass suppresses only the missing-ID traceability rejection. The hook
still runs staged readiness. An untraced implementation commit is rejected;
only a readiness-safe documentation bootstrap can pass without an ID. The
bypass does not create or approve an artifact, and there is no
readiness-bypass environment variable. If a hook is skipped entirely, the
resulting commit appears in `nous_package.py drift`, and `check-range` / CI
rejects implementation without valid parent ownership and approval. **Don't
use it to skip process.**

## Enforcement

- **Local**: `.githooks/commit-msg` rejects the commit.
- **Local staged readiness**: the hook runs
  `node scripts/work-readiness.mjs check-staged --message-file <canonical COMMIT_EDITMSG>`.
- **Repository range**: `pnpm readiness:check:range -- <base> [head]` detects
  local-hook bypasses and validates every implementation commit in order.
- **Detective**: `python3 nous_package.py drift` reports any orphan
  routes/migrations shipped without a US reference.
- **Future**: a server-side pre-receive hook on Bitbucket/GitHub will
  reject pushes containing orphan commits (not in this drop).

## Fixing a traceability-rejected commit

Two options:

1. **Amend**:
   ```bash
   git commit --amend
   # edit subject to add (US-NNN) or (CHG-NNN)
   ```

2. **Re-commit** (if you haven't pushed):
   ```bash
   git reset --soft HEAD
   git commit -m "feat(xyz): your message (US-NNN)"
   ```

## Finding a story to reference

```bash
grep -l "story_status.*backlog" docs/stories/sprint-*/r1-us-*.md
```

Or check the sprint plan:

```bash
cat docs/stories/SPRINT_PLAN.md
```
