**Work item:** CHG-036
**Readiness assessment:** docs/readiness/CHG-036.json
**Approved estimate:** 110 minutes

# CHG-036 — Retire Ed25519 approval signing

Child 1 of CHG-034 (`partition_required`), the `retire-signing` partition.
Design: `docs/changes/CHG-034-work-readiness-simplification.md` §1 and its
execution-pass correction log.

## Task 1 — Capture the baseline oracle (readiness)

Run `node scripts/work-readiness.mjs check-all --json` with the trust map
provisioned and save the result. Every later task is measured against it: same
verdict per artifact, or history broke (CHG-034 success criterion 3).

Also run it with `WORK_READINESS_APPROVAL_KEYS_JSON` **unset** to record the
pre-cut behaviour — it must fail `WR_APPROVAL_TRUST_UNAVAILABLE` and validate
zero artifacts. That failure is what the cut has to turn into a pass, and it is
the discriminating evidence that the removal is real rather than unexercised.

## Task 2 — Answer the two questions that shape the cut

Before deleting anything, read the call sites rather than the design prose:

1. Does `validateApproval` verify signatures on **historical** records? If yes,
   deleting `verifyDecisionAttestation` breaks all 17 artifacts.
2. Are the `WR_BOOTSTRAP_*` codes part of the signing ceremony, as §1 says?

Both answers changed what this plan removes; they are recorded in CHG-034's
correction log and in `docs/readiness/CHG-036.json` uncertainties U1/U2.

## Task 3 — Remove the signing machinery

In `scripts/work-readiness/model.mjs`:

- delete `approvalAuthorities()` and `verifyDecisionAttestation()`
- drop `createPublicKey` / `verify` from the `node:crypto` import, keeping
  `createHash` (the digest binding stays)
- delete `canonicalApprovalAttestation()` and `ATTESTED_DECISION_KEYS`
- rewrite `validateDecisionRecordShape` so the five attestation keys are
  **optional-but-accepted** rather than required-or-forbidden — the exact-length
  closed key set is why a flag flip would have rejected the 20 signed records
- drop the `requireAttestation` / `allowLegacyReadiness` parameters at all three
  call sites

Leave `approved_by`, `subject_work_id` and `relationship` required by the
approval path: they are binding, not ceremony.

**Boundary check at this task boundary:** if the remaining work looks like it
will exceed the approved estimate, stop and file a `deviation` or `blocked`
feedback event before continuing.

## Task 4 — Update the tests in the same commit

Per CHG-034 Rollout §3, a passing suite that still exercises deleted machinery is
theatre. Remove the signer-wire doc test and the two signing tests; replace them
with the contract that must now hold:

- both ledger shapes (signed and unsigned) validate
- a leftover signature is shape-checked but never verified
- no trust map is consulted anywhere
- the approver binding still refuses a mismatch

Retarget the forged-approval range test: a stripped decision is still refused,
now for binding no approver rather than for lacking a signature.

## Task 5 — Update the doc, measure, and verify

Rewrite `docs/dev-guide/WORK_READINESS.md`'s approval section to describe the
eight-field decision record and say plainly what was retired and why history
stays readable. Then:

- `node scripts/test-work-readiness.mjs` — all behavioral tests pass
- `check-all` — identical verdict to the Task 1 baseline
- `check-all` with the trust map unset — now passes where it previously failed
- record `WR_*` codes raised by enforcement and implementation LOC, before and
  after (CHG-034 success criterion 1)
