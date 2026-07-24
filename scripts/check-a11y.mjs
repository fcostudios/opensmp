#!/usr/bin/env node
// IMP-241/IMP-248 a11y/axe CI step (US-013). NOT WIRED YET — exits NON-ZERO
// on purpose so it never reports a false green. Wire it to a real
// axe-core / @axe-core/playwright run against the built app, then this
// flips to exit 0 once it actually verifies pages.
// TODO: run @axe-core against the built app in CI.
console.error("[a11y] NOT ENFORCED — no a11y check is wired. " +
  "Wire @axe-core/playwright against the built app in CI before relying on this gate.");
process.exit(1);
