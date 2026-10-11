**Work item:** CHG-082
**Readiness assessment:** docs/readiness/CHG-082.json
**Approved estimate:** 300 minutes

# CHG-082 design

Authority: Francisco's approved CHG-082 specification and digest c986a49ff57fe6ed7df3665df48cd239069e51ae97e392385ac4c2d509e86ce4.

The closed bookkeeping list is docs/readiness/**, docs/superpowers/specs/**, docs/superpowers/plans/** and .nous-feedback.jsonl. A shared pure helper counts these separately; expected_changed_files remains a declared delivery count, bounded at 20. bookkeeping_files is an informational nonnegative integer, optional for old assessments and required for future assessments. No diff-size gate is added.

Move the complete existing DIRECT_TEST_ROUTES table verbatim to scripts/mutation-routes.json, retain the exported alias and include JSON bytes in mutation execution fingerprints. For future functional assessments, immutable Git base/candidate comparisons reject executable tooling edits except additive route JSON changes. Preserve every existing key and ordered value prefix. New keys must name a production source changed by the same work item's authorized implementation history; existing keys may append values without that restriction. All newly added tests must be canonical existing regular test files in the candidate tree. Shape and path failures reject with WR_MIXED_FUNCTIONAL_TOOLING. Actual execution evidence remains mutation preflight.

Prospective activation uses committed CHG-082 completion history: an assessment payload digest first introduced after that completion uses the new policy; historical payload introductions remain under the old contract even when fields are omitted. New local payloads use HEAD ancestry. Activation validates CHG-082 approval and completion actuals against its immutable ledger, not a raw event name. Editing an old file into a new payload after activation cannot inherit the old rules by path age. Completion is the integration-ready boundary carried by the fast-forward, so no reclassification occurs on branches lacking that boundary. Approved and pending historical payloads, including CHG-082 itself, stay byte-identical.

There are no tenant/runtime/database changes. No schema migration, threshold, exemption or instrumentation change is in scope. Independent real-Git fixtures cover route ownership, path safety, executable script refusal and prospective omission. The differential oracle reads the predecessor table from immutable Git and compares routedTestFiles for every key. CHG-079/081 remain separate changes; the second integration line migrates their entries and records the SHA map.
