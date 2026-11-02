# US-048 nightly continuation

Use `/Users/fcolomas/Projects/smp-us048` on
`feature/ops/us-048-runbooks-restore-drill`. Do not switch branches, modify the
shared `/Users/fcolomas/Projects/smp` checkout, or merge to main.

`main` was merged in `5278ac0` (main parent
`dfaacd091cf3f27dd242847626914c33f401504d`). The feedback conflict was resolved
by retaining both histories unchanged. DEC-SMP-067 / CHG-115 moves break-glass
to R2 FEAT-R2-13; AC1 now covers Keycloak restart/restore. Runbooks and appended
feedback already record withdrawal of the former blocker. AC3 is human S4
demo acceptance, not a development blocker. Off-host retrieval is also a human
demo check if unperformed. Neither is claimed as completed.

## Scheduled drill

The existing LaunchAgent `com.smp.production-backup` runs at 02:00 local
America/Guayaquil on 2026-11-02 (07:00 UTC). Its initial run count was 3.
The production backup image tag was rebuilt from this worktree with the
ACL-preservation repair. No manual backup was triggered and the LaunchAgent
schedule was not altered. The scheduled runner's existing shared-checkout
path was left untouched.

The Codex follow-up tool failed twice, so no automatic chat resume is
registered. A one-shot local process was started instead:
`.tmp/us048/wait-nightly-drill.py`. It waits for run count to increase, exit
status 0, unchanged schedule and a complete artifact timestamped within
07:00–07:15 UTC. It then runs `.tmp/us048/drill.py` against that artifact,
verifies fresh/restored migrations and exact grants, challenges tampering and
existing-target refusal, checks restore-role revocation and compares per-company
register/statement hashes with the live source. It does not invoke backups,
modify tracked files, commit, or emit `done`. It stops waiting at 03:00 local
and records a failure if the scheduled run is missing.

1. Read `.tmp/us048/nightly-state.json` and `nightly-watcher.log`. A
   `restore_passed_pending_review` result includes the actual signed artifact
   and source/target identifiers. A waiting/failed state is not completion.
2. Review `nightly-launch-before.txt`, `nightly-launch-after.txt`,
   `nightly-drill.log`, `drill-summary.json`, `nightly-comparison.json`,
   `recovery/audit.jsonl` and the fresh/restored migration-verifier logs.
   Keep full logs and identities private. Do not replace a failed scheduled
   artifact with a manual backup and call AC2 passing.
3. Append the actual scheduled result to `us-048-recovery-evidence.md`, with
   manifest time/digest, LaunchAgent run count/exit, restore/schema/grant and
   comparison results. Explain any backup-point differences. The process
   removes the copied age identity after finishing; original keys are untouched.
4. Validate the updated runbooks in the built app image at
   `/auth/operations/operations.md` and all relative links, without a session
   or identity configuration. The prior turn proved this packaging pattern;
   the new `keycloak-recovery.md` must also be included. Avoid disrupting
   the existing production app while other sessions use it.
5. Package type-check/lint/build/test passed again after the merge; source,
   tests, dependencies and migrations are unchanged since that proof. Recheck
   if those inputs changed. Fresh/restored migration proof comes from the
   actual nightly drill. Mark focused verification, append passing AC1 and
   AC2 technical evidence and AC3 documentation-scope evidence. Keep AC2
   off-host retrieval and AC3 IT Director journey `ac_unverifiable` for the
   S4 demo if unperformed, as explicitly instructed by the operator.
6. After review, mark integration and run
   `MUTATION_BASE=dfaacd091cf3f27dd242847626914c33f401504d pnpm test:mutation`.
   This scopes to US-048 rather than old unsynced origin/main work. Expect no
   mutatable TypeScript source; record the actual exit/result without a
   fabricated numerical score. Real Bats red/green evidence constrains the
   shell repairs (three focused backup/restore and ten restore-window checks).
7. Append canonical `done` (not `dev_done`) with a disclosed cost estimate.
   State that development is complete and S4's human production exit is still
   unverified; do not claim earned production acceptance or real-rate H2.
   Commit on this branch and report the final SHA. Do not merge to main.
8. Remove only this drill's `us048-recovery-db` disposable container/volumes
   and `us048-recovery` network after preserving sanitized evidence; leave
   production intact. No Codex heartbeat exists to pause.
