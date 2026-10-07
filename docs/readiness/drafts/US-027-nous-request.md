# US-027 canonical partition request

**Status:** allocation requested (CHG-070 experiment parent). The parent draft is
`docs/readiness/drafts/US-027.json`, `partition_required`, readiness payload
SHA-256 `374eaec6e26cb78fae6e0918d0a05879f4a7118fb96b4b2936208ad83a56abb3`,
approval pending. It is structurally valid. It does not authorize execution.

US-027 (Inactivity flags + usage surface, 2 SP) is assessed at 750 minutes.
It also exceeds the scope, flow, file and primary-outcome limits. Following the
CHG-068 shape, nous mints a functional CHG and three canonical 1-SP vertical
children:

| Proposal key | Outcome | Parent ACs | Estimate | Ordering |
| --- | --- | --- | --- | --- |
| `usage-surface` | SCR-usage (`/uso`) lists per-person last activity and days inactive against a lag-aware data-through date. Includes company and 30/60/90 filters, metric cards, badges and the freshness banner, with group_admin gating and company isolation. | AC1 (read side), AC2 (display) | 260 min | First (CHG-070 experiment child) |
| `propose-reclamations` | An audited batch `proposeReclamations` with an optional note. It creates at most one pending ReclamationProposal per open assignment. | AC1 (batch action) | 230 min | After usage-surface |
| `inactivity-flagging` | An audited daily job sets the anchor LicenseRequest from `active` to `flagged_inactive` when the window trips. It uses the same lag function and is rerun- and race-safe. | AC2 (state), AC3 | 260 min | After usage-surface |

AC1 and AC2 are cross-cutting, and each child carries a rationale for its share.
No parent AC is deferred. US-028 keeps:

- approve and dismiss
- suppression after a dismissal
- `flagged_inactive` to `offboarding`
- `/reclamaciones`

No schema migration is expected. No new route is needed beyond `/uso`, which is
already in the nav map.

## Policy rulings requested (BR-16 has no text in the repo)

- **P1 (lag).** Days inactive equals data_through minus the last activity_date.
  data_through is the latest synced activity_date for the person's vendor
  account. When the account has never synced, it falls back to the evaluation
  date minus 3 days. One pure domain function owns the window and lag math and
  is shared by the screen and the job.
- **P2 (idempotency).** The batch relies on the existing partial UNIQUE on
  pending proposals per assignment (insert, do nothing on conflict).
  `client_request_id` is audited but not persisted, so no migration is needed.
- **P3 (flag ownership).** A daily `inactivityFlagging` job runs after
  `analyticsSync` and flags at the 30-day window. The 60 and 90 day windows
  are display filters only. The job creates no proposals. When activity
  resumes, it moves `flagged_inactive` back to `active`.

Reconcile BR-16 and the rulings in the canonical specs, then deliver through the
normal atomic Nous sync route. Return the functional CHG id and the three
canonical child ids. Then the parent can be promoted to
`docs/readiness/US-027.json` with the ids. The first child gets its own approved
readiness and runs under the CHG-070 protocol.
