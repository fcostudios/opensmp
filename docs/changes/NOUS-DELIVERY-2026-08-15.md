# Nous delivery — 2026-08-15

Response to the dev agent's "Request to Nous".

## 1. Approval trust material — DELIVERED

```
key_id: nous-prod-2026q3
```

The public key map is at **`.work-readiness-trust.json`** in the repository
root. Export it in the environment where you run commands:

```sh
export WORK_READINESS_APPROVAL_KEYS_JSON="$(cat .work-readiness-trust.json)"
node scripts/work-readiness.mjs check CHG-023
```

Verified: the map loads as `ed25519`, and the signed record in
`.nous-feedback.jsonl` verifies against it through
`model.mjs :: canonicalApprovalAttestation`.

The private key is held by Nous outside every repository. There is no signing
command here and there will not be one (`WORK_READINESS.md:114-115`).

> **Still open, not delivered by this note:** provisioning this map into
> `.github/workflows/ci.yml` requires its own approved CHG
> (`WORK_READINESS.md:121-126`), and no key cutoff/revocation policy exists yet
> (`:133-137`). The trust set is append-only.

## 2. Official CHG IDs — ISSUED

Registered in `nous.db` under `fcostudios__smp`:

| proposal_key | Official ID | Title | Est |
| --- | --- | --- | ---: |
| `mirror-sync` | **CHG-024** | Agent guidance mirrors track the layered CLAUDE.md | 75 min |
| `merge-head-gate` | **CHG-025** | Staged readiness validates a merge HEAD against its first parent | 70 min |
| `stryker-ignore-patterns` | **CHG-026** | Commit the measured Stryker sandbox exclusions | 35 min |

Author one `ready` readiness artifact per ID and send Nous the three digests;
each will be signed under `nous-prod-2026q3`. Approval is already given by
Francisco Lomas — only the digests are missing.

### Why these numbers

The ledger held only CHG-001/002/012/013/014/022 for this project. Of the 22
`CHG-NNN` tokens in the checkout, 10 are test fixtures (007, 008, 099, 100,
123-125, 456, 900, 999) and **two are another project's IDs** — CHG-020 and
CHG-021 appear only in `docs/dev-guide/NAVIGATION.md` and `COMMITS.md`, are
dated 2026-04-20, and were written in by the substrate's doc generator. Five
are real but unregistered (004, 005, 009, 010, 011), all below the mark.

True high-water mark was CHG-022 plus the CHG-023 draft, so 024-026 are safe.

## 3. Signed decision for CHG-023 — DELIVERED

Appended to `.nous-feedback.jsonl` (line 502):

```
id: CHG023-PARTITION   decision: partition_required
digest: 5638610bc7c00186def6e20d57f512026f41aba7218c50b3fbc18bbed5f3ce53
approved_by: Francisco Lomas   key_id: nous-prod-2026q3
```

The digest was recomputed from the artifact's own bytes via
`canonicalReadinessPayload` before signing and matched exactly.

This decision sets `authorized = false` (`model.mjs:705,733`) — by design. It
approves the *partition*, not implementation. The three `ready` approvals above
are what unblock work.

## 4. Merge-HEAD blocker — confirmed as described

Verified independently: `HEAD` (`09d5266`) is a two-parent merge commit, and
`work-readiness.mjs:374` rejects any HEAD whose `rev-list --parents` line
exceeds two tokens (`WR_GIT_TOPOLOGY_UNSUPPORTED`). The first commit after any
merge is therefore ungateable by `check-staged`.

The agent's description of this chicken-and-egg is accurate. How to clear it is
an operator decision, not one this note grants; CHG-025 removes the need
permanently.

## 5. Corrections for the CHG-026 artifact

Two factual errors in the CHG-023 draft carry into the `stryker-ignore-patterns`
child. Fix before authoring:

- **AC4 cites "the recorded 170" parse warnings.** Measured value is **29 per
  Stryker startup**, deterministic across four runs. If 170 is a full-campaign
  aggregate, say so explicitly; as written the AC fails against a number that
  does not exist at the stated scope.
- **"the six exclusions"** — `stryker.conf.json` carries **seven** entries; six
  are new (`.tmp` was already present as `.tmp/**`).

Measured evidence, including why the CHG-014 fixture campaign structurally
cannot observe this change: **`docs/benchmarks/stryker-sandbox-exclusions.md`**.
Headline: sandbox drops 5,702 → 1,132 files (−4,570, decomposing exactly to
`.turbo` 4,513 + `docs/screens` 57), parse warnings 29 → 0, mutation score
unchanged at 100.00%. Wall-clock effect is ~4-6% of a full cold campaign — the
80% file-count drop must not be restated as a time saving.
