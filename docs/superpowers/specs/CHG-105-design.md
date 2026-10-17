# CHG-105 owned additive declaration admission

Status: proposed for independent builder review before any source/test edit. Francisco approved readiness digest `f4d2c9270687b794ca310eb9db770026eeaea621ede769b6ee07f02e83bb3f20` through `CHG105-READY-F4D2C927`; standing execution approval covers design, plan and implementation without another human stage approval. Builder review remains mandatory.

## Authority and intent

Implement Outcome A of immutable packet `b79400ffcd31a2dc23ef558fb733a84202859fee` (SHA256 `39c999e0b5614f20ecfc21cb2af0fa1b043811d9772b26325d707d816df98542`) and its `4af1e44556525cfabe6c21b47d7fbc2617478b44` addendum under DEC-SMP-053/056. Canonical source is `/Users/fcolomas/Projects/nous/Nous/WorkControl/fcostudios/smp/CHG-105_TECH_SPEC.md`; the approved readiness artifact resolves its execution hold.

Entry main is `d2280c4e511812da72b82084e6ad2ec891375781`, integrated CHG-104 source `145450f6ce2c701ad6a14ed9507b0e7247eac319`. Isolated branch `feature/readiness/chg105-owned-declaration` starts execution preparation at `4408fa3cf3c52c3c2ebee88a4e044246fbaea7c0`. Preserve the entire original `d2280c4..candidate` interval for custody and final review. Freeze mutation source base at the documentation/entry commit after builder approval, before source changes; never shorten the assurance interval by using a later source commit.

The result is ordinary staged, per-commit and complete-history admission of a functional item's own additive finite declaration. A table present in a final tree is insufficient: its introduction must belong to this exact item's approved current payload and bound plan. Candidate-authored PASS reports never grant authority.

## Scope and boundaries

Exactly six technical paths: `scripts/work-readiness/delivery-policy.mjs`, `scripts/work-readiness/git.mjs`, new `scripts/work-readiness/schema-declaration-ownership.mjs`, `scripts/test-work-readiness.mjs`, `packages/db/src/migration-release.integration.test.ts`, `docs/dev-guide/WORK_READINESS.md`. Exactly four bookkeeping paths: own readiness, this design, own plan and append-only `.nous-feedback.jsonl`.

No delivered product schema, migration or declaration; no API/auth, dependency, configuration, toolchain, TESTING or generated-guide edit. Shared guide and release test follow actual CHG-104 integration sequentially. CHG-107 is pending, with no integration window or work authorized here. Existing DEC051/P4/087/084/097 and functional US-093 responsibilities remain unchanged.

## Design decisions

Use a small pure structural helper and existing immutable Git APIs. Reusing only the current Set of owned paths would allow another item's pre-existing table to be borrowed; trusting a receipt would move authority into candidate data. A SQL parser or database hook would exceed the selected boundary. These alternatives are rejected by the approved contract. The implementation details below are builder choices within that contract.

### Finite declaration boundary

Reuse integrated `parseSchemaContract(bytes, path)` and `attestSchemaContract(declaration)` from `packages/db/scripts/schema-contract-policy.mjs` without editing them. Parse both immutable sides, require regular `100644` JSON, unchanged ordered baseline arrays/rows and unchanged existing `newTables` prefix. Only version 2 with an actually appended nonempty finite new-table row qualifies. Version 1 changes, deletion, replacement, reordering, duplicate/unsafe records and broadening old security remain denied with `WR_MIXED_FUNCTIONAL_TOOLING` at `packages/db/schema-contract.json`.

The only supported row remains at most one `drift_episode` / `drift-episode-v1`: mutable true, RLS enabled true/forced false, exact ledger_app SELECT/INSERT/UPDATE account-reference-exists-v1 predicates, PK(id), four NO_ACTION update/delete foreign keys, unique resolved assignment and the selected unique-open nullable resolved_at predicate. Integrated CHG-104 owns vocabulary and actual catalog validation; CHG-105 adds source ownership only.

### Immutable snapshots and provenance

`git.mjs` builds exact snapshots for immutable authority root, each historical parent/commit and the staged candidate tree. A snapshot contains schema path/mode/blob/text; declaration path/mode/blob/bytes and canonical parsed identity; complete sorted migration filename/path/mode/Git blob/SHA256/bytes. Missing or nonregular entries fail closed. Baseline migration set must be an exact unchanged prefix; appended names must match the existing timestamp migration naming contract. Old file edits, deletion, replacement or mode changes are denied.

Upgrade the walk behind `itemAuthorityPaths` to retain transition records rather than only Set membership. Keep the existing Set projection for mutation-route behavior. Every contributing record contains commit, parent, single subject work ID, computed digest, immutable parent approval and bound-plan validation, plus exact before/after file entries. Do not infer approval from a commit message. The record qualifies only when the immutable parent actually validates active approval for the exact current digest and bound plan. The payload root comes from existing `payloadAuthority`, not the candidate.

The original root's schema AST must lack the declared table. New schema and migration introductions must occur in the same candidate transition as the declaration, or in prior actually approved same-item transitions under that same digest. Track the exact introductions through every transition to the candidate: changed/replaced blobs require their own same-item approved transition; no foreign, unapproved, multi-item, self-approved or later-approved change can lend or repair provenance. Every historical transition is examined, including bad changes later reversed. Current-parent authority checks remain part of ordinary ownership validation. A range endpoint comparison is never a substitute.

### Narrow AST contract

Use the existing locked TypeScript 5.9.3 parser import pattern already in `scripts/mutation-scope.mjs`. No evaluation or semantic compiler framework. Recognize only `export const name = pgTable("drift_episode", { ... })` using the unaliased named `pgTable` import from literal `drizzle-orm/pg-core`. Require a unique direct exported declaration and literal canonical table and column identities. Recognize chained column builders structurally only to read their literal first column-name argument; require the finite descriptor's referenced columns (`id`, `vendor_account_id`, `license_type_id`, `person_id`, `resolved_by_assignment_id`, `member_identity`, `resolved_at`) to exist uniquely. Schema object property names must be identifiers or literal names; no computed/spread/dynamic identity, re-export, alias, duplicate table or spoofed import. Do not claim AST proves SQL constraints or application authorization. Unsupported relevant shapes fail closed; additional frameworks require reassessment.

### Functional policy integration

`validateFunctionalDelivery({root, base, head, workId, authority})` invokes the helper only when declaration data changes. Successful admission exempts that one exact declaration path from the tooling rejection; it does not change `isToolingPath` globally or exempt MJS/source scripts. All other tooling, mutation-route append-only restrictions, shebang checks and the byte-exact inherited CHG-088 exception remain unchanged. Per-commit validation and staged candidate validation use the same immutable evidence builder and helper.

### Real release composition

Extend the existing release integration test, using the official shared PostgreSQL 16 fixture and real ledger_owner/ledger_app connections. Build an actually approved functional Git fixture, execute ordinary admission, then extract the exact admitted commit's schema/declaration/migrations by Git objects into its temporary release bundle. Check copied bytes/checksums against those objects; invoke the unchanged production applier/verifier and parity code. No candidate report is ingested as authority and no owned module is mocked.

Own baseline and candidate runs must preserve old catalog/grants, ledger and parity; exercise actual app rights and relevant account-reference allowed/denied behavior. Wrong-table and no-table append-only SQL deliberately pass structural admission and fail the actual production release verifier. Independently fault RLS, grants, constraints and ledger/checksums at their runtime stage. Bind evaluated commits, source blob/mode identities, declaration bytes, migration hashes, fixture/run UTC, exit codes and raw proof hashes in normal build_pass/source_commit notes and independent review. US-093 still owns actual product delivery and GroupAdmin/company:write/system authorization.

## Assurance and cost

Three reviewed green checkpoints: pure ownership evidence/helper; real Git admission/history; exact Git-to-release composition and guide. Tests are written first, fail for the missing behavior, then pass; each new case names and kills a distinct predicate fault. Use exact rejection category/path or process exit plus diagnostic, never only logs or does-not-throw. Real Git staged/per-commit/full-history positive and hostile cases, baseline differential and independent predicate-removal controls are required.

After scoped reviews and a fresh independent adversarial final review, run the own awake uncached full gate under owner-aware `/tmp/smp-full-gate.lock`, own sharedPG owner/app migrate/verify/parity and actual preflight. One final own native cold campaign runs last after every fix/review. Zero shards is only a forecast: record observed zero honestly, omit test_report, never invent 100%. Preserve full original history/source custody and normal FF receipt.

Complete upper 315 minutes: readiness25, implementation110, focused95, review55, integration30 (base250). Existing readiness spent21 remains readiness; design/plan is implementation cost. No child or parent proof/cost is borrowed. Supported per-role token counters are unavailable; estimate active minutes explicitly and keep actual role/call evidence where supported. At any checkpoint, forecast above315 or any new path/framework/proof gap requires current amendment; above320 or20 paths is a hard stop. Parent10274.5known+U_prior and CHG10499 remain separate.
