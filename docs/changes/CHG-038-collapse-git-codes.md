# CHG-038 — Collapse the fine-grained git-plumbing codes into one message-carrying error

Child 3 of **CHG-034** (`partition_required`), the `collapse-git-codes`
partition. Parent design §4.

## Outcome

The residual git operations raise a single `WR_GIT_ERROR` carrying the
underlying message, instead of ten variants distinguishing shades of "a git
command the checker needed did not succeed" — none of which a caller can act on
differently.

## Correction to the parent design — the rationale, and the count

§4 argues the collapse on the ground that the codes "were substantially in
support of the timestamp-derived clock" and that "with that clock removed, most
git-plumbing failure modes go away because the checker no longer needs to walk
git history."

**Measured after CHG-037 landed: that is not so.** The checker still makes 13 git
invocations across 8 subcommands — `show` ×4, `rev-list` ×3, `ls-tree` ×3,
`merge-base` ×2, `ls-files`, plus `rev-parse` ×2, `write-tree` and `commit-tree`
in the CLI. It still walks history; it simply no longer derives an execution
anchor from commit timestamps.

The collapse stands on §4's *other* ground, which survives: these codes
distinguish failure modes that have **no distinct remedy**. A caller does the
same thing for an ambiguous ref, an invalid ref, an unreadable root and a failed
exec — read the message and fix the invocation. That is what a message-carrying
error is for.

§4 also says "12+ variants". There are **15** `WR_GIT_*` codes raised, and **10**
of them belong to this class.

## What goes — 10 codes into `WR_GIT_ERROR`

`WR_GIT_EXEC_FAILED`, `WR_GIT_COMMAND_FAILED`, `WR_GIT_OUTPUT_LIMIT`,
`WR_GIT_REF_AMBIGUOUS`, `WR_GIT_REF_INVALID`, `WR_GIT_ROOT_INVALID`,
`WR_GIT_FILE_MISSING`, `WR_GIT_CI_FETCH_FAILED`, `WR_GIT_CI_BASE_INVALID`,
`WR_GIT_STATUS_INVALID`.

Each becomes `WR_GIT_ERROR` with its existing message preserved verbatim, so no
diagnostic detail is lost — only the taxonomy above it.

## What stays — 5 codes with a distinct, actionable meaning

These are **not** "a git command failed", and collapsing them would lose
information a caller acts on:

| code | why it stays |
|---|---|
| `WR_GIT_PATH_ESCAPE` | a path resolving outside the repository root — a containment check, not a plumbing failure |
| `WR_GIT_PATH_INVALID` | a structurally malformed path (NUL bytes, absolute, traversal) |
| `WR_GIT_ARGUMENT_INVALID` | caller/API misuse, raised before git is invoked at all |
| `WR_GIT_NON_ANCESTRAL` | the range base is not an ancestor of head — a real reviewable condition |
| `WR_GIT_TOPOLOGY_UNSUPPORTED` | merge topology the range gate cannot interpret |

Net: 15 → 6 `WR_GIT_*` codes.

## Acceptance criteria

- **AC4** — the ten codes above are unreachable from enforcement; `WR_GIT_ERROR`
  is raised in their place and carries the original message.
- **AC5** — `check-all` returns the same verdict for all 20 artifacts as the
  pre-cut baseline.
