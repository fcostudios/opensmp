# US-089 canonical testing guidance dependency request

US-089 is blocked before implementation or digest approval. Publish its already-canonical accepted-member-observation oracle in Nous `testing.critical_paths`, preserving every existing operator addition and the current critical-path rows. This is guidance for existing US-089 / DEC-SMP-043, DEC-SMP-044 and DEC-SMP-045; no new feature, technical-policy change or work ID is requested.

## Why canonical regeneration is required

- AGENTS.md requires: “When you change logic in a `docs/dev-guide/TESTING.md` §3 critical path, update its §3 in the same PR.”
- TESTING.md lines 8–9 says: “This file is generated — do not hand-edit; change it by updating the spec/config it derives from.”
- TESTING.md §3 lines 47–49 requires declaration in `testing.critical_paths`; declared rows publish in both `testing/critical-paths.md` and `docs/dev-guide/TESTING.md` and survive regeneration.
- WORK_READINESS.md §Generated Nous ownership permits registered immutable exact overlay or canonical delivery authority, rather than a local guide edit.

## Requested canonical row

**Atomic member observations (US-089; DEC-SMP-043/044/045)** — only authorized complete account-wide observations enter the append-only MemberObservation ledger. Persisted active vendor capabilities and vendor-scoped license mappings resolve seat evidence and durable identity/license warnings. Real connector journal account/operation/method/attempt pairing, ordered pages and totals prove completeness. Account advisory locking enforces stale rejection, equal-time equivalent no-op, equal-time conflict, and newer acceptance including empty snapshots across sources. Exact audit receipts and `member_observation_accepted` events share the transaction with ordered consumers; later-consumer failure rolls back ledger, audits and earlier effects. Oracle: deterministic real shared-PostgreSQL integration assertions, metamorphic canonical replay, explicit held-lock concurrency, exact audit/event/warning tuples and rollback/retry in `packages/db/src/member-observations.integration.test.ts`; exact public export proof in `packages/db/src/index.test.ts`.

## Delivery requested

1. Append this row through canonical project config, preserving existing additions; regenerate both guides.
2. Deliver the exact guide bytes, substrate revision and applicable provenance/sync/pin artifacts onto `feature/observations/us089-acceptance` (worktree `/Users/fcolomas/.codex/worktrees/us089-acceptance/smp`) or integration main with a recorded revision to consume. Do not hand-edit guides or ask this session to invent pin paths/IDs.
3. State every affected path and canonical ownership route. Ordinary sync envelopes authorize only their allowed generated categories, so a guide delivery must carry the applicable already-established exact guidance/pin route, not assume the three envelope files suffice.
4. Return the canonical commit/revision and confirm existing decisions, delivered US-088 migration/schema and other child allocations are unchanged.

## Assessment and boundary

| Item | Current assessment |
|---|---|
| Outcome | Complete atomic member observation acceptance, canonical US-089 AC1–4 |
| Existing implementation | Four acceptance/root-export source/test files inherited from `6191fe834f940317cec7ecfa81eb43398815627d`, not yet materialized here |
| Integrated prerequisite | Main `2b3a4d8389279a32fec2e86727f1634c19d317bf`, US-088 complete |
| Cost | Historical share124 once + remaining169 =293min (under320); added regeneration/custody15 included |
| Paths | Provisional12 delivery /5 bookkeeping; four DB files +2 guides +up to3 sync envelope +up to3 pin files; reconcile exact delivery before approval |
| Mutation | Forecast2 full-source shards; real diff may be1 acceptance scored shard plus ordinary exact index-export verification seam; discovered by approved preflight |
| Authority | Approval pending; design/plan/implementation and `started` have not begun |

After delivery, inspect both guides (IMP-434), validate envelope/pins under existing rules, record custody/revision, finalize paths/estimate and recompute readiness digest. Obtain the one concrete digest-bound child approval; standing authorization then covers design, plan and implementation without separate stage approvals.

No testing threshold, classifier, runner, grant, schema, provider contract, policy or budget waiver is requested. Worker/confirmed-provision consumers stay US-084, shared drift US-078, CSV producer US-055, capacity US-081. All findings outside US-089 stay named deviations or deferred hardening.
