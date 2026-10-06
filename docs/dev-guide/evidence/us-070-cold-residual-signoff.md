# US-070 exact native cold residual sign-off

**APPROVED: 65/65 residuals independently dispositioned; 46 equivalent, 19 accepted, 0 unapproved.** No genuine missing-oracle or production defect identified in this bounded residual review. This signs the exact cold artifacts below, not a rerun or a replacement broad review.

Authority base `ed9ff60d9dda6aaf78fae5e9a61d189b1a8e4108`; scored source cutoff `e03e465e3e8be975bcaf8ca05662f0bf93bfb25a`; work ID US-070. Recorded completion HEAD matches the cutoff. Independently compared all 18 recorded production/test/migration/verifier file hashes with the current bytes and `git show <cutoff>:<path>` bytes; all match, as do recorded start/end hash maps. Every native report source equals its current file. All seven native JSON SHA-256 values match the immutable preserved artifact records. Manifest SHA-256 verified: `f7c83c8c6cc5ed5ab50ce15405aa1342bb9c10be622f6dcb5bdb4104590b1b7e`. Residual JSON SHA-256 verified: `ca9dd96c1e0f588e5250c4c3a4b5c9d0f2e8d3adb1428764dbaed23e504df183`.

Independently recomputed native totals: **727 mutants = 661 Killed + 1 Timeout + 61 Survived + 4 NoCoverage**. No CompileError, RuntimeError or Ignored entries. Detected score **662/727 = 91.05914718019257%**. Each native shard exceeds 80%; deferred has no residuals.

| Native shard | Killed | Timeout | Survived | NoCoverage | Total |
|---|---:|---:|---:|---:|---:|
| schema-static-481df809eb04 | 11 | 0 | 1 | 0 | 12 |
| vitest-4a99c1dc33c5 | 61 | 0 | 8 | 0 | 69 |
| vitest-766ecaa54205 | 99 | 0 | 7 | 0 | 106 |
| vitest-7e4dfff580cb | 296 | 0 | 22 | 2 | 320 |
| vitest-d6a5d66bfe0f | 77 | 0 | 16 | 0 | 93 |
| vitest-e927482a8578 | 108 | 1 | 7 | 2 | 118 |
| vitest-f2d1787d45e2 | 9 | 0 | 0 | 0 | 9 |

All 65 entries have a one-to-one exact native match on shard, mutant ID, file, full start/end location, replacement, status and artifact hash. Preview matches were independently compared by full source, full location and replacement; the residual decisions below are based on current source semantics, not preview percentages. Dispatch #3 has an older preview match marked NoCoverage whereas its cold status is Survived; the cold residual handoff is correct. An initial verification assertion requiring identical preview status exposed this distinction; the completed check preserves native status and requires identical source/location/replacement.

Contracts #29 retains the required narrower **accepted diagnostic difference** classification. Dispatch #18/#19 likewise change Error versus TypeError for null, so this final sign-off conservatively uses accepted diagnostic difference instead of prior literal equivalence. All still reject unsupported input; no typed diagnostic contract is waived. Prior company-summary-note M1 disposition and generated-doc M2 closure are unaffected.

## Exhaustive current residual annotations

Each line identifies exact cold shard/mutant, current source line/column, classification, native status and exact JSON-escaped replacement; native artifact identity is fixed by the hash table below. NoCoverage entries are explicitly included.

schema-static-481df809eb04:5 packages/db/src/schema.ts:479:28 @equivalent: Drizzle substitutes the source property key for an empty column name, retaining the source mapping and generated SQL. Native=Survived; replacement="\"\"".

vitest-4a99c1dc33c5:29 packages/connectors/src/contracts.ts:202:9 @accepted: Removing the null guard still rejects null through Object.getPrototypeOf(null), but changes incidental Error subtype/diagnostic; no typed validation-error contract exists. Native=Survived; replacement="false".

vitest-4a99c1dc33c5:37 packages/connectors/src/contracts.ts:204:23 @accepted: Malformed known metric objects still reject; only unspecified validation diagnostic text changes. Native=Survived; replacement="``".

vitest-4a99c1dc33c5:55 packages/connectors/src/contracts.ts:213:13 @equivalent: The retained Number.isInteger check independently rejects nonnumeric and nonfinite values; the negative check remains. Native=Survived; replacement="false".

vitest-4a99c1dc33c5:56 packages/connectors/src/contracts.ts:213:13 @equivalent: Changing the type/finite OR to AND cannot admit a value because Number.isInteger and the negative check still constrain all counts. Native=Survived; replacement="typeof metric !== \"number\" && !Number.isFinite(metric)".

vitest-4a99c1dc33c5:57 packages/connectors/src/contracts.ts:213:13 @equivalent: Retained Number.isFinite and Number.isInteger reject nonnumbers without coercion, preserving the count guard. Native=Survived; replacement="false".

vitest-4a99c1dc33c5:66 packages/connectors/src/contracts.ts:215:27 @accepted: Invalid counts still reject; only unspecified error wording changes. Native=Survived; replacement="``".

vitest-4a99c1dc33c5:67 packages/connectors/src/contracts.ts:218:54 @accepted: The recursive path is diagnostic text only; normalization and rejection decisions are unchanged. Native=Survived; replacement="``".

vitest-4a99c1dc33c5:68 packages/connectors/src/contracts.ts:222:49 @accepted: The initial counters path label affects only unspecified diagnostic text. Native=Survived; replacement="\"\"".

vitest-766ecaa54205:4 packages/connectors/src/providers/anthropic/connector.ts:216:16 @equivalent: record(null/undefined) returns null, so optional nested identity fields yield the same null identity. Native=Survived; replacement="false".

vitest-766ecaa54205:52 packages/connectors/src/providers/anthropic/connector.ts:565:20 @equivalent: Additional record conversion for non-analytics pages is unused; the original body still goes to the unchanged cost parser. Native=Survived; replacement="true".

vitest-766ecaa54205:71 packages/connectors/src/providers/anthropic/connector.ts:566:88 @equivalent: Strict inequality against the boolean cursor-presence expression already rejects every nonboolean has_more. Native=Survived; replacement="false".

vitest-766ecaa54205:89 packages/connectors/src/providers/anthropic/connector.ts:692:27 @equivalent: Null provider IDs are never indexed by the unchanged insertion guard, so an unguarded get(null) still returns undefined. Native=Survived; replacement="false".

vitest-766ecaa54205:92 packages/connectors/src/providers/anthropic/connector.ts:693:15 @equivalent: Null emails are never indexed by the unchanged insertion guard, so an unguarded get(null) still returns undefined. Native=Survived; replacement="false".

vitest-766ecaa54205:100 packages/connectors/src/providers/anthropic/connector.ts:698:13 @equivalent: Inserting a null provider-ID key is unobservable because the unchanged lookup skips null IDs. Native=Survived; replacement="true".

vitest-766ecaa54205:103 packages/connectors/src/providers/anthropic/connector.ts:699:13 @equivalent: Inserting a null email key is unobservable because the unchanged lookup skips null emails. Native=Survived; replacement="true".

vitest-7e4dfff580cb:24 packages/db/src/analytics-ingestion.ts:37:7 @accepted: Exact ISO roundtrip retains acceptance/rejection for JSON date inputs; malformed non-JSON coercion/Symbol inputs may change incidental diagnostic behavior, which is not promised. Native=Survived; replacement="false".

vitest-7e4dfff580cb:25 packages/db/src/analytics-ingestion.ts:37:7 @accepted: Exact ISO roundtrip retains acceptance/rejection for JSON date inputs; malformed non-JSON coercion/Symbol inputs may change incidental diagnostic behavior, which is not promised. Native=Survived; replacement="typeof value !== \"string\" && !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)".

vitest-7e4dfff580cb:26 packages/db/src/analytics-ingestion.ts:37:7 @accepted: Exact ISO roundtrip retains acceptance/rejection for JSON date inputs; malformed non-JSON coercion/Symbol inputs may change incidental diagnostic behavior, which is not promised. Native=Survived; replacement="false".

vitest-7e4dfff580cb:30 packages/db/src/analytics-ingestion.ts:37:37 @equivalent: Exact ISO-date equality against the original whole string prevents prefixes despite removal of the regex start anchor. Native=Survived; replacement="/\\d{4}-\\d{2}-\\d{2}$/".

vitest-7e4dfff580cb:31 packages/db/src/analytics-ingestion.ts:37:37 @equivalent: Exact ISO-date equality against the original whole string prevents suffixes despite removal of the regex end anchor. Native=Survived; replacement="/^\\d{4}-\\d{2}-\\d{2}/".

vitest-7e4dfff580cb:75 packages/db/src/analytics-ingestion.ts:51:7 @equivalent: Serializing the complete normalized tree preserves duplicate equality because allowlist reconstruction fixes key order. Native=Survived; replacement="true".

vitest-7e4dfff580cb:79 packages/db/src/analytics-ingestion.ts:51:7 @equivalent: Normalized counter roots are nonnull fixed-order objects; whole-tree JSON serialization preserves their equality relation. Native=Survived; replacement="value !== null".

vitest-7e4dfff580cb:81 packages/db/src/analytics-ingestion.ts:51:25 @equivalent: Whole-tree serialization of the normalized object retains every nullable/integer field and deterministic key order. Native=Survived; replacement="typeof value === \"object\"".

vitest-7e4dfff580cb:82 packages/db/src/analytics-ingestion.ts:51:42 @equivalent: Replacing the object type label routes the normalized root through whole-tree JSON serialization with the same equality relation. Native=Survived; replacement="\"\"".

vitest-7e4dfff580cb:84 packages/db/src/analytics-ingestion.ts:52:7 @equivalent: The array branch is unreachable because normalization rejects arrays at every supported object path. Native=Survived; replacement="false".

vitest-7e4dfff580cb:85 packages/db/src/analytics-ingestion.ts:52:36 @equivalent: Array formatting is unreachable: normalized allowlisted counters contain only objects, nullable values and integer counts. Native=NoCoverage; replacement="``".

vitest-7e4dfff580cb:86 packages/db/src/analytics-ingestion.ts:52:66 @equivalent: The array separator is unreachable because no normalized known counter path admits arrays. Native=NoCoverage; replacement="\"\"".

vitest-7e4dfff580cb:88 packages/db/src/analytics-ingestion.ts:53:14 @equivalent: Allowlist reconstruction already fixes key order, so removing canonical entry sorting cannot alter duplicate equality. Native=Survived; replacement="Object.entries(value)".

vitest-7e4dfff580cb:89 packages/db/src/analytics-ingestion.ts:53:41 @equivalent: Leaving reconstructed entries in insertion order preserves deterministic duplicate equality for supported counters. Native=Survived; replacement="() => undefined".

vitest-7e4dfff580cb:92 packages/db/src/analytics-ingestion.ts:54:77 @equivalent: Removing commas remains injective for fixed quoted allowlisted keys and nullable integer/object values; this private representation is used only for equality. Native=Survived; replacement="\"\"".

vitest-7e4dfff580cb:149 packages/db/src/analytics-ingestion.ts:75:22 @equivalent: Null duplicate keys are never stored by the unchanged insertion guard, so emails.get(null) remains undefined. Native=Survived; replacement="false".

vitest-7e4dfff580cb:163 packages/db/src/analytics-ingestion.ts:81:9 @equivalent: An inserted null Map key is never read because the unchanged lookup explicitly skips null keys. Native=Survived; replacement="true".

vitest-7e4dfff580cb:166 packages/db/src/analytics-ingestion.ts:87:88 @accepted: Additional shared locks on global read matching preserve identity/scope safety but can add contention; no unlocked-read or latency contract is specified. Native=Survived; replacement="true".

vitest-7e4dfff580cb:228 packages/db/src/analytics-ingestion.ts:134:21 @equivalent: FOR SHARE without OF locks all relations in the account/vendor join, exactly the two explicitly named relations. Native=Survived; replacement="{}".

vitest-7e4dfff580cb:238 packages/db/src/analytics-ingestion.ts:136:39 @equivalent: Company projection is consumed solely as row existence; an empty selected object preserves existence and locking. Native=Survived; replacement="{}".

vitest-7e4dfff580cb:245 packages/db/src/analytics-ingestion.ts:139:37 @equivalent: Actor projection is consumed solely as row existence; an empty selected object preserves actor verification and locking. Native=Survived; replacement="{}".

vitest-7e4dfff580cb:298 packages/db/src/analytics-ingestion.ts:163:13 @equivalent: A suppressed conditional upsert holds the conflicting row with synced_at at least incoming; locked Person scope ensures the current row exists and cannot be older. Native=Survived; replacement="false".

vitest-7e4dfff580cb:299 packages/db/src/analytics-ingestion.ts:163:13 @equivalent: Conflict-row locking and the upsert timestamp condition make the altered missing/older clause unreachable; equal-time contradiction rejection remains intact. Native=Survived; replacement="!current && current.syncedAt.getTime() < batch.syncedAt.getTime()".

vitest-7e4dfff580cb:301 packages/db/src/analytics-ingestion.ts:163:25 @equivalent: After the held-lock upsert returns no row, current.synced_at less than incoming is unreachable. Native=Survived; replacement="false".

vitest-d6a5d66bfe0f:3 packages/connectors/src/dispatch.ts:403:70 @accepted: Malformed records envelopes still reject; only unspecified envelope-validation error text changes. Native=Survived; replacement="\"\"".

vitest-d6a5d66bfe0f:18 packages/connectors/src/dispatch.ts:405:15 @accepted: Null/primitives still reject through property access or required fields; null can produce TypeError instead of Error, an unspecified diagnostic difference. Native=Survived; replacement="false".

vitest-d6a5d66bfe0f:19 packages/connectors/src/dispatch.ts:405:15 @accepted: The weakened object guard still rejects null/primitives through property access or required fields; null can change Error subtype, not accepted input. Native=Survived; replacement="!record && typeof record !== \"object\"".

vitest-d6a5d66bfe0f:21 packages/connectors/src/dispatch.ts:405:26 @equivalent: The retained falsy guard rejects null; other primitives fail required field checks, and functions cannot survive the preceding structuredClone. Native=Survived; replacement="false".

vitest-d6a5d66bfe0f:41 packages/connectors/src/dispatch.ts:408:16 @equivalent: The final strict ISO string equality rejects every nonstring date even without the typeof check. Native=Survived; replacement="false".

vitest-d6a5d66bfe0f:45 packages/connectors/src/dispatch.ts:408:60 @equivalent: Whole-string ISO equality rejects prefixes despite the relaxed regex start anchor. Native=Survived; replacement="/\\d{4}-\\d{2}-\\d{2}$/".

vitest-d6a5d66bfe0f:46 packages/connectors/src/dispatch.ts:408:60 @equivalent: Whole-string ISO equality rejects suffixes despite the relaxed regex end anchor. Native=Survived; replacement="/^\\d{4}-\\d{2}-\\d{2}/".

vitest-d6a5d66bfe0f:54 packages/connectors/src/dispatch.ts:409:64 @equivalent: A guarded canonical YYYY-MM-DD string parses as UTC without the suffix, preserving the validity decision. Native=Survived; replacement="\"\"".

vitest-d6a5d66bfe0f:58 packages/connectors/src/dispatch.ts:410:47 @equivalent: A guarded canonical YYYY-MM-DD string parses as UTC without the suffix, preserving the exact ISO day comparison. Native=Survived; replacement="\"\"".

vitest-d6a5d66bfe0f:60 packages/connectors/src/dispatch.ts:411:29 @accepted: Invalid records still reject at the same boundary; only unspecified diagnostic wording changes. Native=Survived; replacement="\"\"".

vitest-d6a5d66bfe0f:70 packages/connectors/src/dispatch.ts:420:81 @accepted: Mixed activity dates still reject; only unspecified diagnostic wording changes. Native=Survived; replacement="\"\"".

vitest-d6a5d66bfe0f:73 packages/connectors/src/dispatch.ts:421:29 @equivalent: Null IDs are never indexed by the unchanged insertion guard, so get(null) cannot find a previous record. Native=Survived; replacement="false".

vitest-d6a5d66bfe0f:76 packages/connectors/src/dispatch.ts:422:17 @equivalent: Null emails are never indexed by the unchanged insertion guard, so get(null) cannot find a previous record. Native=Survived; replacement="false".

vitest-d6a5d66bfe0f:84 packages/connectors/src/dispatch.ts:424:86 @accepted: Conflicting identities still reject; only unspecified diagnostic wording changes. Native=Survived; replacement="\"\"".

vitest-d6a5d66bfe0f:85 packages/connectors/src/dispatch.ts:427:15 @equivalent: Null-ID insertion cannot affect records because the unchanged lookup skips null IDs. Native=Survived; replacement="true".

vitest-d6a5d66bfe0f:88 packages/connectors/src/dispatch.ts:428:15 @equivalent: Null-email insertion cannot affect records because the unchanged lookup skips null emails. Native=Survived; replacement="true".

vitest-e927482a8578:39 apps/worker/src/jobs/analytics-activity.ts:51:11 @equivalent: Empty account rows yield empty eligible rows; the unchanged eligible-length guard exits before KEK or credential reads. Native=Survived; replacement="false".

vitest-e927482a8578:61 apps/worker/src/jobs/analytics-activity.ts:61:20 @accepted: Removing trim changes whitespace-padded KEK path acceptance only; configuration does not promise path whitespace normalization. Native=Survived; replacement="options.kekFile".

vitest-e927482a8578:62 apps/worker/src/jobs/analytics-activity.ts:61:20 @accepted: Missing KEK still rejects, with an incidental TypeError instead of the explicit untyped configuration diagnostic. Native=Survived; replacement="options.kekFile.trim".

vitest-e927482a8578:65 apps/worker/src/jobs/analytics-activity.ts:62:11 @accepted: Missing or empty KEK still rejects in real readKekFile validation; only unspecified failure diagnostics change. Native=Survived; replacement="false".

vitest-e927482a8578:66 apps/worker/src/jobs/analytics-activity.ts:63:25 @accepted: Missing KEK still rejects; its untyped prose diagnostic is not specified. Native=NoCoverage; replacement="\"\"".

vitest-e927482a8578:91 apps/worker/src/jobs/analytics-activity.ts:96:15 @equivalent: The shipped fixed REST syncActivity never returns unsupported, so provider-failure conversion remains identical. Native=Survived; replacement="false".

vitest-e927482a8578:93 apps/worker/src/jobs/analytics-activity.ts:96:33 @equivalent: The shipped fixed REST syncActivity never returns unsupported or an empty failure code, so this comparison remains false. Native=Survived; replacement="\"\"".

vitest-e927482a8578:94 apps/worker/src/jobs/analytics-activity.ts:97:29 @equivalent: The fixed shipped REST Anthropic syncActivity returns success or provider/capacity failure, so this unsupported-only branch is unreachable. Native=NoCoverage; replacement="\"\"".

vitest-e927482a8578:99 apps/worker/src/jobs/analytics-activity.ts:104:38 @equivalent: Only explicit table query builders are used; removing relational schema configuration preserves select/insert/transaction semantics. Native=Survived; replacement="{}".

## Separate detected timeout

`vitest-e927482a8578:116 apps/worker/src/jobs/analytics-activity.ts:136:17–138:10`, replacement `{}`, is **Timeout**, not a survivor. It removes the finally body containing client.release(), permitting pool shutdown to stall. This is a detected resource-lifetime fault; the native classification supports detection, while no deeper timeout stack is claimed. It is neither accepted nor counted among the 65 residuals. The preserved campaign results report successful scoped-fixture and owning-cluster cleanup without nested errors; this does not erase earlier failed preview teardown evidence.

## Immutable native artifact hashes

- `cold-native-schema-static-481df809eb04.json` — `86585f1cd8fbfe3996f0fd728090c9f19a882589be1c67ba7b08fbaba45dfc82`.
- `cold-native-vitest-4a99c1dc33c5.json` — `d81f45d565810fc940b38cd915a2ccaa0a61d5898bc8fcdaf4c3f194a41eb621`.
- `cold-native-vitest-766ecaa54205.json` — `75156d058449c18b9fbe9a301e4024409379f94266ac4a68232740000c04393b`.
- `cold-native-vitest-7e4dfff580cb.json` — `2b22259539cf872ababdc69edcfdb5c24f86aa25bb6f93ad4b111518c36045c9`.
- `cold-native-vitest-d6a5d66bfe0f.json` — `058d20aadea72148a03a1285727d2fb5b34271adea9d99b5e363fedcdf980a96`.
- `cold-native-vitest-e927482a8578.json` — `4318deee1d8d7ce9402bd07cf8fa2f7e91199cb7bde13584553425ab05f4de97`.
- `cold-native-vitest-f2d1787d45e2.json` — `f0dc09328e4797a4bd7f51026e74a88296f99c2b2b25a29ef8871a6ea08cb706`.

## Method and cost

Read only cold campaign report/results/residuals, seven preserved native JSONs, referenced preview JSONs and bounded current source around residuals. Performed independent hash, commit-byte, status/count and exact-location/replacement reconciliation through `rtk proxy python3`; no test/campaign rerun, production/test/config edit, feedback emission, or subagent. Only this sign-off was written. One attempted controller status message failed with agent-thread-limit reached; it had no effect on evidence or approval.

Reviewer: gpt-6-astra, final_review. Own rollout pointer: `/Users/fcolomas/.codex/sessions/2026/10/05/rollout-2026-10-05T23-38-09-01a10f81-3a4e-74e0-a190-b532e50d7eb6.jsonl`. Final measured metadata snapshot follows separately; this reused seat includes the earlier broad and scoped re-reviews, so cumulative totals are not isolated cold-review cost.

Pre-final cumulative measured snapshot: 33 custom_tool_call + 3 function_call records (wrapper counts, not nested shell invocations); peak last input 179557 tokens; cumulative output 18373 tokens; model gpt-6-astra; context window 258400. Metadata only, no unrelated transcript; excludes the final response and this still-running tool result.
