# Commit Conventions — Traceability Required

Every commit on this repo **must** reference a user story (`US-NNN`) or
change request (`CHG-NNN`) somewhere in the commit message (subject or body).

This is enforced by `.githooks/commit-msg` — a client-side guard installed
via `infra/scripts/install-git-hooks.sh`.

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

## Install

```bash
./infra/scripts/install-git-hooks.sh
```

Idempotent. Sets `core.hooksPath=.githooks` for this clone.

## Exempt commit types

The hook skips:

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

The bypass is logged as an audit trail via the env var and the resulting
commit will appear in `nous_package.py drift` output with no owner —
which will trigger a pipeline review. **Don't use it to skip process.**

## Enforcement

- **Local**: `.githooks/commit-msg` rejects the commit.
- **Detective**: `python3 nous_package.py drift` reports any orphan
  routes/migrations shipped without a US reference.
- **Future**: a server-side pre-receive hook on Bitbucket/GitHub will
  reject pushes containing orphan commits (not in this drop).

## Fixing a rejected commit

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
