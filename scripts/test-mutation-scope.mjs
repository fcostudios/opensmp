#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  requireRoutedTestFiles,
  routedTestFiles,
} from "./mutation-scope.mjs";

const syntheticExists = (path) => new Set([
  "src/account.test.ts",
  "src/account.integration.test.ts",
]).has(path);
assert.deepEqual(
  routedTestFiles(
    ["src/story.spec.ts", "src/account.ts"],
    ["src/account.ts"],
    syntheticExists,
  ),
  [
    "src/account.integration.test.ts",
    "src/account.test.ts",
    "src/story.spec.ts",
  ],
);
assert.throws(
  () => requireRoutedTestFiles(["src/account.ts"], ["src/account.ts"], () => false),
  /mutatable source has no responsible Vitest test route: src\/account\.ts/,
);
assert.deepEqual(
  requireRoutedTestFiles(
    ["src/story.test.ts", "src/entry.ts"],
    ["src/entry.ts"],
    (path) => path === "src/story.test.ts",
    { "src/entry.ts": ["src/story.test.ts"] },
  ),
  ["src/story.test.ts"],
);
assert.throws(
  () => requireRoutedTestFiles(
    ["src/story.test.ts", "src/covered.ts", "src/orphan.ts"],
    ["src/covered.ts", "src/orphan.ts"],
    (path) => path === "src/covered.test.ts" || path === "src/story.test.ts",
  ),
  /mutatable source has no responsible Vitest test route: src\/orphan\.ts/,
);

const base = execFileSync("git", ["rev-parse", "HEAD^"], {
  encoding: "utf8",
}).trim();

execFileSync(process.execPath, ["scripts/mutation-scope.mjs"], {
  env: {
    ...process.env,
    MUTATION_BASE: base,
    MUTATION_SCOPE_DRY: "1",
  },
  stdio: "pipe",
});

const generated = JSON.parse(
  readFileSync(".tmp/stryker.generated.conf.json", "utf8"),
);

assert.equal(generated.coverageAnalysis, "off");
assert.deepEqual(generated.vitest, {
  configFile: "vitest.mutation.config.mjs",
  related: false,
});
assert.equal(generated.concurrency, 1);
assert.deepEqual(generated.testFiles, [...generated.testFiles].sort());
assert.ok(generated.testFiles.includes(
  "apps/web/src/components/users/users-roles-panel.test.tsx",
));
assert.ok(generated.mutate.includes(
  "apps/web/src/modules/identity-access/users-roles-page.tsx",
));
