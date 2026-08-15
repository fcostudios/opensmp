**Work item:** CHG-031
**Readiness assessment:** docs/readiness/CHG-031.json
**Approved estimate:** 55 minutes

# CHG-031 — Commit hook resolves the approval trust map from the repo

## Problem

`scripts/work-readiness/model.mjs:495` reads the trust map only from
`WORK_READINESS_APPROVAL_KEYS_JSON`. Git hooks do not inherit an interactive
shell's exports, so a routine `git commit` fails with:

```
WR_APPROVAL_TRUST_UNAVAILABLE: No protected Nous approval public-key map is provisioned
```

Every operator and every agent has to remember
`export WORK_READINESS_APPROVAL_KEYS_JSON="$(cat .work-readiness-trust.json)"`
before every commit. Forgetting it looks like a gate failure rather than a
missing variable.

## Change

`.githooks/commit-msg` — when the variable is unset **and**
`.work-readiness-trust.json` exists at the repo root, export it before invoking
`check-staged`.

## Why this does not weaken the gate

Confined to the hook. **Git never runs hooks in CI**, so CI and the repository
range gate keep reading only the protected variable and still fail closed when
it is absent (`WORK_READINESS.md:119-126`). CI provisioning stays **CHG-027**.

Reading trust from a tracked file in CI *would* be a real weakening — a pushed
commit could add an attacker's public key alongside the signature that key
validates. Locally it grants nothing new: anyone who can edit the trust file can
already export any value they choose, so the boundary on a machine its owner
controls is unchanged.

The hook never overrides an explicit export and never validates the contents;
`model.mjs` still rejects missing, malformed, unknown and non-Ed25519 trust.

## Verification

The verification must use a staged set that **actually consults the trust map**.
An assessment-only staged set (readiness artifact + feedback log) does not, so a
pass there is not evidence — confirmed empirically during this change, where
absent and corrupt trust both still passed because trust was never read.

| AC | Setup | Expect |
| --- | --- | --- |
| AC1 | implementation-class staged set, env unset, trust file present | pass |
| AC2 | same, trust file absent | `WR_APPROVAL_TRUST_UNAVAILABLE` |
| AC3 | same, trust file corrupt | fails closed |
