# CHG-091 correction context in readiness consumers

Canonical authority: `/Users/fcolomas/Projects/nous/Nous/WorkControl/fcostudios/smp/CHG-091_TECH_SPEC.md`, delivered Nous commit `99b9709`; request `189b6e2a0827974cce357bab4cb8d484e4caaf00`. Concrete approved readiness digest: `b467465a3e5f4f0f59bd8107bd3a1b7ebf72a5ebdf5cf147d48fc46a18428903`, 100 minutes, four delivery paths, four bookkeeping paths, zero mutation shards. Approval is recorded before execution in `9d2cd27`.

## Outcome and correction

Two existing consumers lose context required by the already delivered CHG-089 policy. Exact inherited replay parses immutable raw feedback but omits the independently committed annotation authority when validating its assessment. The feedback-order CLI loses raw-line identity through JSON.parse and omits committed annotation authority when validating lifecycle corrections. Both reject the legitimate rebased US-088 bundle despite its unchanged approval and exact verifier transition.

Reuse the existing raw parser and authority-loading primitive. Each replay assessment must receive authority from the same frozen authorization revision used to validate its artifact and feedback. The feedback-order CLI must resolve its repository context once to an immutable commit, load independently committed correction authority from that pin, and preserve original parsed record identities and line diagnostics. A later commit, working-tree artifact, unchecked caller map, or invented fallback cannot grant authority. Existing non-Git ordinary feedback fixtures must retain their behavior; correction fixtures requiring committed authority use disposable real Git.

No changes to model policy, generic classifier, hooks, runners, thresholds, product sources/tests, or closed CHG artifacts. Preserve exact US-088/digest4904/verifier path/c793-to4b/modes100644 and all transition/history guards. Preserve CHG-089 raw identity, one-use, actor, terminal, story/item and independent authority guards.

## Proof and scope

Delivery paths are exactly `scripts/work-readiness/git.mjs`, `scripts/check-nous-feedback-order.mjs`, `scripts/test-work-readiness.mjs`, and `scripts/test-feedback-order.mjs`. Bookkeeping is this design, the technical plan, readiness, and append-only feedback.

Three acceptance flows map canonical AC1–4: actual coexistence RED/GREEN; hostile pinned-authority/raw-byte/history cases; separate reviewed technical integration followed by unchanged current-child proof. Tests must exercise actual helpers/CLI using real disposable Git, not mocks or model-only assertions. Retain the initial real child RED evidence; isolated omission/raw-parser faults must be killed by intended behavioral oracles rather than setup errors.

Required governance suites, technical readiness/range/order/check-all, zero-source mutation preflight, independent complete-diff review and owner-safe awake stock full gate precede integration. AC4 remains pending until integrated absolute CLI proves unchanged current US-088 delivery/range/order/ready. Baseline child `0301e89ccfbeaf340e7c3046de129af112ad852c`, tree `3b30ae443c54f9c9a9ff514876b25917dbc243d6`, original rejected `a80cf209e7698c2f0197072068cfc8667b3ea487`, all13 current entries, migration `289e93cafc3478648ba406248b6b701bd8cc81e9` mode100644, protected latest-main pins and ordered11map are captured read-only. Technical session never edits functional index/source/history. US-088 resumes only after technical completion; its existing waiver is neither changed nor generalized.
