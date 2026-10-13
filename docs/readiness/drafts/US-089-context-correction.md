# US-089 context correction packet — preparation only

This packet corrects the evidence for deferred Nous request `ee54839b-cbd3-4253-9767-f623e2b9f6cb`. It is **not submitted**. No implementation, design, readiness approval, shared-main edit or rebase is authorized here.

## Minimal requested critical-path addition

**Atomic member observation acceptance (US-089; DEC-SMP-044)** — complete account-wide observations are serialized by the account advisory lock: older observations are stale, equal-time identical canonical content is a no-op, equal-time contradictory content conflicts, and newer observations (including empty snapshots) are accepted. Exact audit receipts and the typed member_observation_accepted event share one transaction with ordered consumers; a later consumer failure rolls back the ledger, audits and earlier effects. Oracle: deterministic shared-PostgreSQL replay/empty/concurrent-lock and exact audit/event/rollback-retry assertions in packages/db/src/member-observations.integration.test.ts, plus exact package export proof in packages/db/src/index.test.ts.

This replaces the broader proposed row in the earlier request. It adds only canonical US-089 temporal/replay/transaction assurance; US-088 provider and persisted catalogue/schema delivery stays unchanged. Preserve all four existing operator additions byte-for-byte and in order, re-read live server config, append through `testing.critical_paths`, and regenerate BOTH `docs/dev-guide/TESTING.md` and `testing/critical-paths.md` using the established canonical ownership/pin route.

## Remaining operator and canonical authority requirements

1. The existing project credential must gain the correct project-scoped `read_project` capability. Exposed `request_knowledge_search` is currently rejected; no candidate, canonical snapshot or pin ID has been proved. Capability repair is operator controlled; this session did not change credentials or bypass the server.
2. Confirm/register the actual `package_roots` workspace key and the applicable `source_roots`/marker mapping for this child checkout. An alternative is registered main authority references plus the full attached child request/assessment bodies and hashes. Do not relabel child `b1b48bc` bytes as current main `ae98f9f`.
3. Run ordinary server context preflight for every source/locator/revision/hash after registration. Marker files and local immutable Git hashes prove local file facts; they do not establish server registration, canonical snapshots or pins. The submit draft intentionally contains no invented `workspace_ref`.
4. Nous must name the canonical CHG/domain authority and obtain the explicit human approval needed for guidance generation. These remain pending; no ID or approval is invented. Return the canonical revision, exact two guide bytes, pins/provenance and complete affected-path inventory. An ordinary envelope alone must not be assumed to authorize generated guides.
5. Then the controller may consume delivery under ordinary gates, inspect both guides (IMP-434), reconcile exact paths and costs, and prepare a fresh concrete digest. Resume remains manual; this packet grants no implementation authority.

## Evidence custody

- Child owned readiness/request/story: Git revision `b1b48bc9613c8fb87709fb958d506123236a4cc4`.
- Current main policies/guides: Git revision `ae98f9fd4206a2e933355ec438cf9970ac3579bf`.
- Canonical disk story/decision matrix: Nous repository revision `87c62ceed23eb25c1d836653d0fe9ac8cb492b06`, file facts only.
- Inherited four source/test artifacts: immutable `6191fe834f940317cec7ecfa81eb43398815627d`, exact blobs/modes in evidence JSON; not materialized into this worktree.
- The existing readiness payload digest `01b79d134682886f71bd55c0a99b815b3f6e49c9b453f789b1c7334ece52238a` remains unchanged and blocked. The full original request remains attached separately in `US-089-nous-request.md`; this packet is its narrower correction.

See `US-089-context-correction-evidence.json` for exact SHA-256 hashes, Git blobs, file modes, marker contents and preserved operator rows. See `US-089-context-correction-submit-draft.json` for the draft request body and explicitly unresolved registration. Neither is server-validated evidence yet.

## Cost disclosure

The pending assessment declares293 minutes: historical124 once plus remaining169. This correction-packet preparation adds an estimated15–20 active minutes including source-contract correction if wholly incremental; an indicative308–313 forecast is unapproved and must be reconciled against actual preparation at reassessment. Historical split is not measured billing, no US-088 cost/waiver is borrowed, and no new readiness payload or ceiling is silently changed. Stop for Nous if the verified full forecast exceeds320 or another hard cohesion limit.

## Rules causing the dependency

`AGENTS.md` requires a same-PR §3 update when changing a critical path. `TESTING.md` lines8–9 states “This file is generated — do not hand-edit”; its §3 requires the config/regeneration route. The prior direct local amendment is therefore unauthorized. No change to that rule is requested.

## Source-contract correction before submission

The draft now carries five **provisional, not server-validated** references: four current-main tenant policy/guide files and `substrate_spec` locator `stories/r1_misc_us_089.md`, relative to the registered v1 root. Child readiness/request/story refs are omitted until an operator supplies the real registered `workspace_ref`; the exact full child bodies and hashes remain labeled attachments. The decision matrix remains a full local file attachment and citation, never a `source=decision` file-path/hash reference; that source requires a canonical artifact ID/digest resolved through IMP-444. No such ID is known or fabricated. The request body explicitly supersedes `ee54839b-cbd3-4253-9767-f623e2b9f6cb`.
