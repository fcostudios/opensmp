# CHG-084 — readiness counting independent of rebase

Francisco allocated the technical fix in167802bc. The classification defect is reproducible: unchanged US-024 artifact fails WR_MISSING_PROPERTY after rebasing onto completed CHG-082. Root cause: readinessDeliveryPolicy walks Git payload-introduction history and forces bookkeeping_files on rebased historical payloads; validateAssessment also treats the historical caller flag as authority.

Contract: absent signals.bookkeeping_files means legacy inclusive expected_changed_files and the same20-path hard limit. Present nonnegative integer means CHG-082 delivery-file counting plus separately informational bookkeeping. No schema2 adopted. No commit-order/activation/rebase-position dependency in this choice. Keep all approved artifacts/approval fields byte-identical.

Preserve functional additive-only JSON route enforcement, changed-source ownership, existing tests, instrumentation/thresholds and all other readiness/lifecycle gates. Git history may still authorize ownership; it must not classify counting. Update the contradictory CHG-082 prose and fixtures; do not modify generated testing guidance.

Own six delivery paths: scripts/work-readiness/git.mjs, scripts/work-readiness/model.mjs, scripts/test-chg082.mjs, scripts/test-chg084.mjs, scripts/test-work-readiness.mjs, docs/dev-guide/WORK_READINESS.md. Four bookkeeping paths: own readiness, this spec, own plan and ledger. No application/database edits.

Verification: real temporaryGit predecessor/policy integration/rebase fixture with unchanged artifact bytes/digest validates; legacy21 inclusive refuses exact WR_TOO_MANY_FILES; explicit16delivery+5bookkeeping validates; invalid bookkeeping integer remains refused. No schema2 means conditional fourth fixture inapplicable, recorded. Run full Node readiness contracts and focused084fixtures. CHG085 pin then shared awake fullgate. Own technical scope has zero TS mutation sources; prove through preflight/ordinary zero-source command rather than fabricate score.
