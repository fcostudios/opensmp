# CHG-036 — Retire Ed25519 approval signing, keeping signed history readable

Child 1 of **CHG-034** (`partition_required`), the `retire-signing` partition.
Parent design: `docs/changes/CHG-034-work-readiness-simplification.md` §1 and its
execution-pass correction log.

## Outcome

Approval decisions are digest-bound records naming a human approver, with no
cryptographic attestation. The 20 already-signed decision records in
`.nous-feedback.jsonl` still validate, and no key material is needed to read
history.

## What goes

`approvalAuthorities()` (the `WORK_READINESS_APPROVAL_KEYS_JSON` trust map) and
`verifyDecisionAttestation()` (key lookup + Ed25519 verification), with five
codes: `WR_APPROVAL_TRUST_{UNAVAILABLE,INVALID}`, `WR_APPROVAL_KEY_UNTRUSTED`,
`WR_APPROVAL_ATTESTATION_{INVALID,REQUIRED}`.

## What stays, and why it is not a flag flip

`validateDecisionRecordShape` enforces an **exact-length closed key set**, and
the ledger holds two shapes — 20 signed (10-key) and 42 legacy (5-key). Flipping
`requireAttestation` to `false` would fail all 20 signed records with
`WR_APPROVAL_EVIDENCE_INVALID` and break every one of the 17 artifacts. So the
attestation keys become **optional-but-accepted**: present or absent both
validate, neither is verified.

Three fields the parent design listed as signing are **binding** and survive:
`approved_by` (the recorded human decision), `subject_work_id` (which item is
approved) and `relationship` (self vs controlling_change). Only `key_id` and
`signature` were ceremony.

The digest binding (`readiness_payload_sha256`) is untouched and remains the
tamper-evidence for every decision, old and new.

## Acceptance criteria

- **AC1** — no signature-verification code path remains; the five codes above
  are unreachable from enforcement.
- **AC5** — `check-all` returns the same verdict for all 17 existing artifacts
  as the pre-cut baseline.
- **AC6** — with `WORK_READINESS_APPROVAL_KEYS_JSON` unset, `check-all`
  validates all 17 artifacts (pre-cut it validated zero).

## Evidence

- Pre-cut baseline: 17 valid, exit 0. Post-cut: byte-identical verdict.
- Discriminating check: trust map unset → pre-cut `WR_APPROVAL_TRUST_UNAVAILABLE`
  and zero artifacts; post-cut all 17 valid.
- Tests updated in the same commit (parent Rollout §3): the two signing tests and
  the signer-wire doc test are removed and replaced by the both-shapes-validate
  contract. 188 behavioral tests pass.
- Measured: implementation 2,775 → 2,745 lines; codes raised by enforcement
  92 → 73.
