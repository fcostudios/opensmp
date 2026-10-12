# CHG-082 — US-024 integration provenance

Francisco authorized rebasing us-024 onto main (8c1f638) and relocating the closed CHG-079/081 routes to mutation-routes.json. Approved readiness payloads are preserved byte-for-byte. This records integration work; it does not reopen the closed items or declare US-075 complete.

Original tip: eade67d98acd9a0f80b38a2a50d653992b872b64. Rebased tip: cdd847c077326b7cd9583257bf2ba04a2fdbbf87. Backup ref: backup/us024-pre-main-rebase-20261012.

Route relocation was resolved in the original work-id commits: CHG-079 cce85d4 → 0f39618 (people action); CHG-081 b6e67ea → e093f73 (lifecycle); CHG-081 4a4e114 → dc5fc74 (two additional responsible routes for the existing US-075 delivery). The router implementation is exactly main’s CHG-082 implementation; no thresholds or instrumentation changed.

Differential: predecessor has 61 entries, not 59: main57 plus four existing CHG-079/081 registrations. Identical table and routedTestFiles outputs for all61, with both synthetic always-true and real filesystem existence, compared by importing the complete immutable predecessor router and current router. All requested59 entries are covered. No route dropped. Runtime assertions exited zero; detailed evidence retained in /tmp/us024-route-differential.json. CHG-082 focused suite also passes all34 fixtures (node --test scripts/test-chg082.mjs, 9.478seconds). Complete predecessor shim was temporary, untracked and removed after the comparison.

Post-rebase inspection: testing/critical-paths.md SHA25641a9566719dc6088393a6514035d653ca13f975b90a2eb707455cd936d3474f7 and docs/dev-guide/TESTING.md SHA25671c65e1cb6b8e77ff883b33a3bb05947d17dd3c9794bed40dbe2d91cee0853d0 remain byte-identical. US-024/075 and CHG-079/080/081 readiness files remain byte-identical. Canonical sync conflicts retained main’s later Nous envelope, CHANGES and SPRINT_PLAN; application changes replayed. Ledger conflict merged only incoming appended rows after preserving all main rows. No committed ledger entry rewritten. Two already-published sync-only commits collapse onto their mapped predecessor; all88 original commits have a recorded mapping below.

Ruling: preserve the historical approved payloads without adding bookkeeping_files — Francisco explicitly keeps approvals valid. Cost if wrong: integration remains blocked rather than silently reclassifying an approval. Current readiness check US-024 fails WR_MISSING_PROPERTY because the historical introduction moved after CHG-082 activation during rebase. No local harness exemption, fabricated reapproval or hook bypass. Fast-forward ancestry is available; integration is held until this historical-provenance gate defect is resolved. US-075’s separate failed mutation campaign/partition status also remains unchanged.

## SHA map (CHG-066 precedent)

| Original | Rebased | Subject |
|---|---|---|
| adb533d57aa980bc3e1fdb7128bf26f74e14f25b | e43defd8dc72a93b93c5fad27ee6412ae29fb287 | docs(US-024): assess readiness and request canonical offboarding partition |
| 11b03ad429da27c4e7aab53e0af2a37c82399f10 | 3e69387bc8d7c38a0c37975c9b4d6968a3ee64b2 | chore(CHG-074): Nous sync 2026-10-11 — partition US-024 into canonical children US-075, US-076, US-077; DEC-SMP-029..033 |
| 7093a02024a1d9d313533d18685870cd4d746858 | 0eada9e46553b6ded11e7d0ff7c7a25ecdf24695 | docs(US-024): promote canonical partition readiness for approval |
| 019a1dafb120b82cdd47bede88cd3672f8a74484 | d858eaa82d305844991966a02bae41fe4a22f62c | docs(US-024): record approved canonical partition digest |
| 7b26d51c42f8803ebae6dceed0fe568cddc64d0d | 53cecde7487a440c08793fd3fbbd24ff649551fb | docs(US-075): record readiness blockers and request canonical amendment |
| 00f2b151e50c3ea3f1954adec83f7de6aaa88acd | 5ccbd2a491efca5c9d5f954931345ee1b07c9339 | chore(CHG-076): Nous sync 2026-10-11 — amend CHG-074: US-075 repartitioned into US-075/US-081/US-082; DEC-SMP-040..042; pools/vendor-account/dashboard TOONs (also carries CHG-075's US-078..080 delivery, previously synced on us-030 only) |
| fff48a053bba4c26b8ad7d28cb032d4f475fc799 | e05dbace7fd7ed70fd8f292cfed9c1acfd2d820b | docs(US-075): reassess amended anchored removal for approval |
| 67e553a1ea9e3b742b58e1159a9c74b6ce6415e0 | b65f77a9172c070b9f4c7087447fdfb94d020ca7 | docs(US-081): request vertical partition for three-screen scope |
| 0e56c7fd77de664bdc48d8bfb6c5b3c62a614364 | 2d97242a64e0850790a41b4331aec17dc194b2e3 | chore(CHG-078): Nous sync 2026-10-11 — US-081 split by screen limit into US-081 (vendor-account foundation) + US-085 (pools/dashboard overview); also carries CHG-077 (US-083/US-084/US-078, DEC-SMP-043..046), previously synced on us-030 only |
| bbea2f17a516948f5350f1b66f78ea81681960ef | fdd0b244edb774ded61b5f7f7b47e1951e7a8e73 | docs(US-075): record approved readiness digest |
| 9ef6da2a9e41e0750547300286dcacb0ed6092e6 | 2ede758e511063a5a98879c12cf04f3edfb98861 | docs(US-075): design anchored removal and atomic checklist finalization |
| dd7fd701ddca768871431d794c5e88cb4646f3cb | 1e987c99bf5ba70fd669a241b3d95422ae86bc2d | docs(US-075): record scoped design review |
| 70826e1d74589517046022c533d0752463dc3d32 | a6a82089d3171c4172eeff4eef6fe746f6c7eb45 | docs(US-075): record design and standing execution authorization |
| ebbeaec3a235875ae16cb258853f0bbe555b430b | e6050eafbf4508b26a1526700fdb8dca990b5b0a | docs(US-075): bind consolidated anchored removal implementation plan |
| b9a5584552535c7188bf1f527adbc375e4a15bc7 | cd5c341e053e02ba75b44996ac1cce732cb92ef0 | docs(US-075): align plan with exclusive shared gate file lock |
| 37666528d03a50e2529cad4382f2a5ae146dca63 | 783d09df4467e27462dec440cc64ac4855d02e02 | docs(US-075): pin shard preflight and manual attempt replay audit |
| 7706298b08ef25f916a0a6ce208bf0f29764b6e7 | 42e57dc38804eec5e47c8c0bb23fb9bbdd6a4250 | docs(US-075): freeze mutation base and start approved execution |
| 5a3f7e41f7f72d5241e8bf2333ebc6292d79777a | 88cb290a42b96ee8ff941a725a7973bc53858269 | feat(US-075): start targeted removal with pending execution selection |
| 80a50349f1fcae3af7ffbb440cecbda759a7d5ff | 347cbd198171d8a95743fa3959c781d0bacc427e | docs(US-075): record focused verification and task review boundary |
| 4b924d7ab11d0792bd5043343d468b2d7e5b3c06 | 3c3046c4c2fac4092fb0e881710953ad2a71e25a | fix(US-075): verify assignment pointer and route production target parser |
| c5ffed251ea96af75794a7e4144ae1611fb5bbf7 | 24d7dcffe7ba43dbea29eda6d38215a24e6997a0 | docs(US-075): request canonical repartition for actual verification routes |
| 00f0ddc52c7cb48d3dd447cb3bea526048857f56 | e2456bca4ac43ec1543e3f23aa2a2a539a7a8efa | docs(US-075): include exact adapter policy in canonical request |
| 81e18b4908b6f3f97d2cbdb2bea4be3c4761b361 | 9a00d1371ecefde0eca97148c3bc8dc0720fb919 | docs(US-075): withdraw unsupported estimate and minimum-path claims |
| ea077fc36b34b3da6b9955397123a4fd58435313 | b0f395a737137642818f8ae67fdeee3ab0419da2 | docs(US-075): validate smaller composition and reconcile estimates |
| d3311e36437f59cad092dbabff985f65db3eb2b8 | 6424fbf3ab27379ea607df3f6042f619794fb889 | docs(US-075): reconcile whole-item forecast and routing prerequisite |
| d45120e8987902634226d66b160cbef3d9f7367e | 6424fbf3ab27379ea607df3f6042f619794fb889 | chore(CHG-079): Nous sync 2026-10-11 — CHG-079 technical prerequisite for US-075 (route registration allocated); canonical testing/critical-paths.md regenerated from the graph (BR-14 governed by US-024/042/075/077/082; BR-01..11 governing stories as canonically declared) |
| c8f331717f86b40f8195acc8d7e90d797a53a8a6 | 32c1addbc3396a8180c59cb3af8bbbf6ba043646 | chore(CHG-079): Nous sync 2026-10-11 — canonical testing/critical-paths.md regenerated from the graph (BR-14 governed by US-024/042/075/077/082; seven cross-tenant governances removed from BR-01..11) |
| 999c02235b70ffbc579a4534b320ea2b132fc9ac | e77cceb6c325d026e26f2ef97ff6d0380759db7b | docs(CHG-079): assess bounded route and canonical critical pin readiness |
| 2bba3d90b500121b80036e5e3c68cbb9a459bb63 | 429968463db9cbf9b225b928e0e5d8531e9b2cf6 | docs(CHG-079): record approved readiness digest and all-stage authority |
| 1c7acf8d96fd6cdef65d067b37d49f7acebed89d | c9991655c6d46655e34f4f2ecb778a14e75c5aad | docs(CHG-079): bind reviewed route and immutable pin plan |
| d08534d7753eee9a8c51d7a13d8f01e0f6fec84c | 2e5a5fa242cb3d7bb6b1a6259797baa17be73df5 | docs(CHG-079): begin authorized bounded implementation |
| 249ea6606e4941f637ad333df278bd8f3cecda46 | e86202c4c9e01b430a0aa3754ce9dae1331b63f9 | docs(CHG-079): record baseline mutation fixture verification boundary |
| 2be5283cbbfe1f820e216164bd1a92ebe8ab2301 | 396e26842176898fe3ccad860b1ef48822692edd | fix(CHG-079): pin canonical critical guidance layer |
| cce85d4446c13c79ceeadf9a2a0b40ae6943c911 | 0f39618cd4700e68be493573df82291a0a991f49 | fix(CHG-079): route people-action mutations to repository suite |
| 7cf1d22645d5421adc5d2e4b58a8ac967b0d5bb9 | b32674e3da24537c12e5fa8ed6053be7270dd806 | docs(CHG-079): record focused verification and review phases |
| f1c4508b4c0a835630d3710ad88a2d9eb456223f | 832b31733c842ea6d4f6538566a28cb83bd53955 | docs(CHG-079): record fresh route and immutable pin AC verification |
| d9d5d48fa1201c7865687a1ef4f6ce8933e97b58 | ec75e7bdb5f79cf3175b8b678991eae12c12d80a | chore(CHG-080): Nous sync 2026-10-11 — publish capacity-refresh critical path (config v44 operator row: US-081/US-085, DEC-SMP-031/041); TESTING.md §3 regenerated (BR-14 children, cross-tenant governances removed) |
| 647928dcce907107ce8ac1e20a702b89c9ca83da | 8f288921077ccfcc71050fbb8cf0f41f5f6281ed | docs(CHG-080): assess canonical guidance pin readiness |
| e65653449d7d884f61e2ce70b301d630adebcd46 | e294bd4558550f04f5ec88aa90ba9367f6220e8a | docs(CHG-080): record all-stage readiness approval |
| af3541ec36aeb95d0ed70ee35ea517e74bec2893 | e42bb1241071642fb4e367751a0606cbe677005d | docs(CHG-080): bind approved guidance pin design and plan |
| ef9242f52168119468c1c68cf6f9b251edcef7c6 | a1eb757bbcfaecccf1abc7f4e028c4877327809b | docs(CHG-080): begin reviewed bounded pin implementation |
| 5fe2ee72342a0afb1cc545e493b26e77ac896d6e | 15d425b6db556639c5bd620d3781b72121f179b0 | fix(CHG-080): pin published capacity-refresh guidance |
| 07467e95389cf0c0884512f6f15d70ddb5b3f646 | e37189d2f2689dfa05820afc8c6c5b1330e9e89b | docs(CHG-080): mark pin review and verification boundaries |
| fe509ee2d0ef8c6e21a305b4c9df024b143d3896 | b18733befe77584863bb57ac824f06a0519b2466 | docs(CHG-080): mark shared integration gate boundary |
| 4221a8827c808bef93606091d19b2807ee5c5002 | ba578f4285ebae83bf979b45af0c9ba40787fa70 | docs(CHG-080): record verified pins and blocked shared gate |
| 5917e1b39ea6b58f2af3ad8df04c79ea9d03a996 | bcec58d5b189b102269e0e02fc70e83831d5bed2 | docs(CHG-079): record incomplete gate evidence and explicit prerequisites |
| c04b812f702ab0a30f578712573caf2a1313b098 | 70134eaafd8b67c52cbde3428e754b17e9b69818 | docs(US-075): reassess fixture repair and request responsible route |
| ae0427a0ad9bc27f7958c6fd31d8aecb1b2b0f0c | 70134eaafd8b67c52cbde3428e754b17e9b69818 | chore(CHG-081): Nous sync 2026-10-11 — allocate CHG-081 (technical successor to CHG-079: lifecycle.ts → orchestration.integration.test.ts route for US-075) |
| b28e3da5a0429081a19035879de11e6b6cafe285 | fc3aa7e28b857ff0648bd5b48249da4aba60b06c | docs(CHG-081): propose lifecycle route readiness and runtime composition |
| 0bfd0c9fd28a7f1617c4cb31b6a5ca9d37db78a4 | 42597962d343d3498b98dc21c2e5ef31008bfcc2 | docs(CHG-081): surface mandatory runtime report contract blocker |
| e4f3793c0caff9bfab2992a2520a8fed3f7da2a5 | 49542a4c63f5ba46105a08b8fa48b7ae2a1b38ef | docs(CHG-081): bind delegated readiness and runtime reporting decision |
| 68aa9f23dfd357a20e94de3585d42d9099f702a9 | 7d84c1ca4fa291f6cdd0316ebecdab611acfeeb9 | docs(CHG-081): bind reviewed route plan and forced inline continuation |
| b6e67ea72539f31bed9ece75798d1e2f7e25581a | e093f732a3c426a3c315f897fe672e9e3cd50f7c | test(CHG-081): route lifecycle mutations to real orchestration oracle |
| 95fac1f5356bf026729c883f0e9706cf240469c2 | 9d3b74e091f094db76cb1d3c86831e18f31acafc | docs(CHG-081): record genuine route runtime proof and scoped review |
| e14f813bf1233680a2c4646bc95708450f3e4f14 | 688398cafb26d3ed0ab395429af906beb39535ea | docs(US-075): authorize evidenced twenty-path continuation |
| 7c6ab51942b683197e67f7621f1b16a8d82d7ada | 610e2faf28bdc5eb4b6d4fbdfaf80350038a907f | docs(US-075): bind revised twenty-path removal execution plan |
| 9e7618f2e06736526cd3db781da1cac58b8a3bdc | 8a82d8e484168a41e1eea01817ef7ac02aef78e5 | docs(US-075): release reviewed consolidated continuation |
| 0b82facb4f0fe776df69098412e289721a4a8340 | acb655877f535d127c376238df341d3b5d8ae35f | feat(US-075): expose authorized anchored offboarding targets |
| a0af6ede4384e5132e279a0a27106a39678acc77 | b2ce293c91232ae08d94cf20141afa4bbfc9a317 | fix(US-075): reject explicit invalid intents before removal |
| 8cfd8810dd1ca49a403477685a15be582a5aaa87 | 8fe7ce344a06440dae1a0abf435f77c09cd7e625 | feat(US-075): finalize anchored checklist removal atomically |
| 1b79bdf5fd760de82a0b3fd2c5b923b29a239339 | c1b939fe24d682560602b694395decff2c05ce8e | docs(CHG-081): reassess three responsible routes under delegated authority |
| 99bb22591205083ba05f46a87d96be4893cf3622 | afd1c5717350b3df4e6ef6ac43029583797fafb9 | docs(CHG-081): bind reviewed three-route continuation plan |
| 4a4e114a5b6248943a5cd088909c55448cf1ae3c | dc5fc742e8834b573843ccccc4a07c2e3ef8ded0 | test(CHG-081): register responsible wrapper and offboarding routes |
| 2f7ea67ca090a836261335db1e6ad835fd374dba | 086302ae9b790119b08b6a5644c3030ed5ad9ed8 | docs(CHG-081): hand off three-route source checkpoint with runtime pending |
| 6c22883c6241b0b467552f9f4cf6386e0a2667f7 | ae47907af19691d5362de861651ca55639386a1a | docs(US-075): bind reviewed routing correction and resume scope |
| 8eb15ba714ab5f78e5d15923cef7cf5cf7333d7d | ec09edf952f91ba9dd5699cade50d36082e3878c | US-075 connect anchored offboarding UI and real transaction journey |
| 0112caa3bd358c79cb9117209123d1cfbc2ca70d | 8e2616a6cac612ec6c1218549b5c9679f74ad480 | US-075 verify fixed request removal through real UI transaction |
| 1fbf489583bdd8a6692f85c39077f69f4a73bff0 | 4775c83b2e58d9d066f413e0757c44924cc12d65 | docs(CHG-081): record native PostgreSQL routing and actual selected-suite proof |
| 6e37fbb8415d5198c6f985e7dfd83ce7e0fd65d7 | 7a627219c3601c5b00cac0cbfcfd41f383dfe09e | docs(US-075): record scoped reviews and actual runtime evidence |
| fee7d288214defc99ce682cea6742e36d6b26a5e | 6f0bc59ad24c88852e356a1700e049d3868a36e8 | docs(US-075): record fresh adversarial AC verification |
| bd9868700b48397657107f31e2bd255505825758 | 4bb02089397ee25dec0f403db2a0a35cb07d4a45 | docs(US-075): reconcile verification budget and release final gates |
| eacf5f8a9188ebbfc58d455e5e8807bc27b6e673 | e59c1dd8fdc0344ff374a8ddc3be79d956e66e39 | feat(US-075): preserve authorization denial audits on removal |
| 915d62192659ee7e33365ca129c1c8cb6677350b | 35b263e590a13864a330c3f43d32549f7af9072e | docs(CHG-081): bind revised audit recognition readiness approval |
| d5c1e5017d3dc96aa1eb49e03bb5543bc09d9bc9 | c901593678ff33070f3facb54f606803a109e7a6 | docs(CHG-081): approve fail-closed atomic audit recognition plan |
| 1861defd0c62e181726574e822e436759c9914f4 | 78e251ddc0eb3c8267e0897f0e3b76afaf2aad5f | docs(CHG-081): approve verified audit receipt readiness |
| b02b5fe8b815bc6cba88988414a3bef3ee962294 | c4c4f5282ed0b2ddd742082e63eb03c339afaff1 | docs(CHG-081): approve same-transaction receipt design and plan |
| 33155cc5fec852998059ef428797449c643c1c4c | d2dbbd57228fb8d3ef2eafb935f1c2591e9a4741 | docs(US-075): approve verified audit receipt consumption |
| 66fa8b430e3762aba95c27cfd6df26480515e423 | 0f51fe9ea120abc2276bb63c003bf9d3d375af8d | CHG-081 verify durable audit receipts in the owned transaction |
| c216f86d6bd0d1ea76d82b3d386d3a2b10e5fc04 | a6dfc17c5adbe7c80124b6fd34245f3b56d2abbf | feat(US-075): verify atomic removal audit receipts |
| 053d802e11a1af4330a7cec5a70606b247a447a5 | 91f2af57852ebc5f7d5afd2271fe8474f96c487c | CHG-081 reject forged receipts and revoke audit context |
| 571905eb703763a69bb0e33c87daaa0de390bd4c | 3057915f3670fb2e68abf7a9e4e6463cc0e09645 | US-075 approve direct primitive oracle repair after invalid cold proof |
| 9c015204076127e44e04fca6deb8d37335cdf0b4 | e382616ac0587df1a962b843b4a10f9164abacc0 | US-075 bind delegated direct oracle readiness decision |
| 5256269e19bc79536beff34e9068eb0cb563746d | dc13fb93a345f8293acbed3303ecf19da2398959 | US-075 approve bounded direct oracle repair design and plan |
| 9048f6b5612d7492004d656660e3b2f538b10413 | 47e599f7232a4e253116ef321bfaf5b3dc411cf1 | test(US-075): exercise sandbox finalizer and exact removal refusals |
| 25cdc25b522023b79e983880da8ac659167db13e | d2aa9658ce40f4e8e45ebd256bc4fc312d744aa8 | US-075 record measured hard-limit reassessment and vertical partition request |
| e9de8dc9611d78d736ef3e339c907065baed96f1 | b8336c72c9acc47f7b1c4d7c2ce3181c2d881db0 | CHG-079 close accountable route and canonical pin with current gate evidence |
| 18fabec752322c2d41ef79b116a459b24e476ea8 | dd3554a6b25755c4c8dbcb10947a0d8617a28f44 | CHG-080 close generated guidance pin with independent verification |
| eade67d98acd9a0f80b38a2a50d653992b872b64 | cdd847c077326b7cd9583257bf2ba04a2fdbbf87 | CHG-081 close lifecycle route and verified audit receipt prerequisite |
