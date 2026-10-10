# CHG-070 experiment entry — Nous repair request

US-072 readiness, design and plan are approved. Plan approval is recorded in
`8e8571c`; implementation has not begun. The plan requires valid governing
CHG-070 readiness before experiment execution.

## Reproduction and root cause

The reused US-072 scoped reviewer ran `pnpm readiness:check -- US-072` (pass)
and `pnpm readiness:check -- CHG-070` (exit 1, WR_APPROVAL_ORDER).

Historical CHG-070 events in `.nous-feedback.jsonl`:

- Line 1071: started, 2026-10-07T03:44:39Z.
- Line 1072: readiness phase, 2026-10-07T03:44:39Z.
- Line 1075: resumed readiness phase, 2026-10-10T13:53:29.723Z.
- Line 1078: first digest-bound approval, 2026-10-10T13:54:35.622Z.

`validatePreapprovalHistory` in scripts/work-readiness/model.mjs scans these
originals before the approval. It exempts feedback/actuals_corrected but does
not exempt delivered annotation-class phase events. Started is a lifecycle event,
and no approval existed before that start. Both problems need explicit handling.
`isProjectableEvent` supports only build_pass, ac_verify and terminal events;
it cannot omit/correct a mistaken historical started or phase. Appending another
approval does not fix the scan. The historical bootstrap start exemption applies
only to CHG-022 and must not be copied.

## Requested canonical work allocation

Please allocate an official technical repair work item for:

1. Consistent preapproval treatment of delivered non-execution annotations.
2. A narrowly bound, append-only correction path for mistakenly recorded
   historical lifecycle starts, preserving the original record and chronology.

The repair must not invent earlier human authorization, exempt real preapproval
implementation, silently rewrite old evidence or weaken digest binding.
Provide canonical scope/ACs, then obtain its own readiness/design/plan approval
and implement in its own session. CHG-072 covers the separate feedback-order
annotation-before-start checker, not this validator/lifecycle repair. Closed
CHG-062 has no active repair authorization; CHG-070's approved experiment scope
is not a general validator-policy repair.

## Resume condition

Deliver the approved correction and demonstrate both readiness checks pass.
Then resume the approved US-072 plan on chg-070 with one implementer and the
existing scoped reviewer. Freeze its implementation mutation base after the
correction and entry approvals; do not charge this separate repair's execution,
diff, previews or transcript costs to the US-072 experiment. The controller
has not launched tests, full gates or a campaign; the reviewer diagnosis was
read-only and its reused session count remains one.
