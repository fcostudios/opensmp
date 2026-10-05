# US-026 canonical partition request

**Allocation delivered:** CHG-068, Nous `10cd1fcd`, smp `1ac81e1`.
The request below is retained as allocation history. `daily-person-activity`
is US-070 and `revisable-person-cost` is US-071; DEC-SMP-024 and DEC-SMP-025
are reconciled in the delivered canonical specs.

**Approval batch completed:** Francisco approved both presented payloads on
2026-10-05. The parent is now `docs/readiness/US-026.json` and the child is
`docs/readiness/US-070.json`; both have matching digest-bound decision evidence
and pass readiness validation. US-070 starts its own design/plan sequence.
US-071 remains dependent on US-070 and needs its own approved assessment.

Francisco approved the following policy recommendations in the Codex
conversation on 2026-10-05; the approval is recorded in `.nous-feedback.jsonl`:

- Persist an allowlisted per-record payload sufficient for replay, retaining
  metrics, dates, provenance and necessary identity fields. Exclude request
  headers, credentials and unrelated user data. Reconcile the canonical
  `raw_payload` requirement with this policy (US-054-SN-004).
- Default unconfigured VendorAccounts to `manual` ingestion. API ingestion is
  enabled explicitly per account. Ingestion mode is independent of provisioning
  mode (DEC-SMP-018).

The original allocation request used the parent draft, now promoted to
`docs/readiness/US-026.json`, as the assessment input:

| Proposal key | Outcome | Parent ACs | Estimate | Ordering |
| --- | --- | --- | --- | --- |
| `daily-person-activity` | Accurate person-day activity, idempotent source-aware writes, API-only daily scheduling and unmatched-identity warnings | AC1, activity side of AC3/AC4 | 270 minutes | First |
| `revisable-person-cost` | Exact person-day costs with bounded 30-day revisions, source-aware writes and unmatched-identity warnings | AC2, cost side of AC3/AC4 | 240 minutes | Depends on activity's shared ingestion boundary |

AC3/AC4 are cross-cutting: each stream needs its own matching, warning,
non-API-exclusion and freshness evidence. No parent acceptance criterion is
deferred. Actual CSV/manual-entry flows stay with US-055; freshness UI stays
with US-029. No new screen is proposed.

The child specifications must include append-only schema/grant migrations,
contract corrections, production worker execution and their verification;
these are vertical deliveries, not separate backend/test stories. The activity
connector must retain documented per-user metrics instead of copying an
organization summary into each person's row.

Reconcile source specs and deliver through the normal atomic Nous sync route;
do not hand-edit generated story files in this repository. Return the official
IDs and canonical AC allocation. Then the local draft can be promoted and each
child can receive its separately approved readiness assessment and Superpowers
design/plan workflow. The draft's `partition_required` classification is
structurally validated, but its readiness approval is still pending; it is not
an execution permit.
