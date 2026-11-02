# US-035 Statement finalization implementation plan

**Goal:** Finalize one statement or the authorized period drafts with explicit confirmation.
**Spec:** docs/stories/sprint-3/r1_misc_us_035.md and docs/specs/08_scope.md AC1–AC3.
**Architecture:** Domain transition policy, shared Zod commands, audited PostgreSQL transaction, existing close server actions and screen. Reuse US-032 rate locking and US-034 immutable-final triggers. No statements-list changes.

- [x] Add failing real-PostgreSQL tests for single/bulk finalization, confirmation, tenant isolation, role denial, stale rates, idempotency, immutable evidence and next-draft adjustments.
- [x] Implement domain policy and transactional commands. Lock period, then scoped statements, then consumed vendor accounts in order; reject stale license-rate evidence before status changes. Audit each changed statement atomically.
- [x] Wire authenticated actions, revalidate close/statements/detail/rates surfaces, and show scoped status chips with single and period confirmation forms on close.
- [x] Verify functional tests, types, lint, build, fresh committed migrations, adversarial ACs, then the final diff mutation campaign. Emit build_pass, AC evidence, test_report and done; commit this branch.

**Review focus:** cross-company IDs; forged roles/confirmation; concurrent close/rate edits; partially failing bulk writes; stale draft evidence. Finals and reconciled rows must remain byte-identical on retries.

Final evidence: all Definition of Done gates passed; 35 focused PostgreSQL/signed-session/UI checks; final cold diff campaign 96.12% (223 killed, 9 reviewer-approved equivalent survivors, no uncovered/timeouts/errors). Fresh review approved.
