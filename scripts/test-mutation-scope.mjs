#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DIRECT_TEST_ROUTES,
  classifyVerificationOnlyHunk,
  groupRoutedMutationTargets,
  mutationCompatibleTestFiles,
  readFreshMutationReport,
  requireNonzeroMutationReport,
  requireRoutedTestFiles,
  routedTestFiles,
  runVerificationCommands,
  verificationCommandsForSources,
  verificationAuditsForReport,
} from "./mutation-scope.mjs";
import mutationVitestConfig from "../vitest.mutation.config.mjs";

assert.deepEqual(
  mutationCompatibleTestFiles([
    "apps/web/src/modules/audit/audited-actions-enforcement.test.ts",
    "apps/web/src/modules/vendor-catalog/actions/manage-capacity.test.ts",
    "packages/db/src/migration-release.integration.test.ts",
    "packages/db/src/schema-parity.test.ts",
  ]),
  ["apps/web/src/modules/vendor-catalog/actions/manage-capacity.test.ts"],
);

assert.deepEqual(
  DIRECT_TEST_ROUTES["apps/web/src/modules/vendor-catalog/capacity-recovery-outbox.ts"],
  ["apps/web/src/modules/vendor-catalog/capacity-service.integration.test.ts"],
);
assert.deepEqual(
  DIRECT_TEST_ROUTES["apps/web/src/modules/vendor-catalog/no-seat-observation.ts"],
  ["apps/web/src/modules/vendor-catalog/capacity-service.integration.test.ts"],
);
assert.deepEqual(
  DIRECT_TEST_ROUTES["apps/web/src/modules/request-workflow/approval/repository.ts"],
  ["apps/web/src/modules/request-workflow/approval-repository.integration.test.ts"],
);
assert.deepEqual(
  DIRECT_TEST_ROUTES["apps/web/src/modules/vendor-catalog/actions/manage-capacity.ts"],
  ["apps/web/src/modules/vendor-catalog/actions/manage-capacity.test.ts"],
);
assert.deepEqual(
  DIRECT_TEST_ROUTES["packages/db/src/provisioning-routing.ts"],
  ["packages/db/src/provisioning-routing.test.ts"],
);
assert.deepEqual(
  DIRECT_TEST_ROUTES["packages/db/src/schema.ts"],
  ["packages/db/src/schema.test.ts"],
);
assert.deepEqual(
  DIRECT_TEST_ROUTES["packages/contracts/src/index.ts"],
  [
    "packages/contracts/src/capacity.test.ts",
    "packages/contracts/src/identity-access.test.ts",
  ],
);
assert.ok(
  mutationVitestConfig.test.projects.includes("packages/domain/vitest.config.ts"),
  "the aggregate mutation runner must execute accountable domain tests",
);
assert.ok(
  mutationVitestConfig.test.projects.includes("packages/connectors/vitest.config.ts"),
  "the mutation runner must execute accountable connector tests",
);

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
  groupRoutedMutationTargets(
    ["src/a.ts:1-2", "src/a.ts:5-5", "src/b.ts:3-3", "src/c.ts:4-4"],
    (source) => source === "src/c.ts" ? ["src/c.test.ts"] : ["src/shared.test.ts"],
  ),
  [
    {
      mutate: ["src/a.ts:1-2", "src/a.ts:5-5", "src/b.ts:3-3"],
      sources: ["src/a.ts", "src/b.ts"],
      testFiles: ["src/shared.test.ts"],
    },
    {
      mutate: ["src/c.ts:4-4"],
      sources: ["src/c.ts"],
      testFiles: ["src/c.test.ts"],
    },
  ],
);
assert.throws(
  () => groupRoutedMutationTargets(["src/orphan.ts:1-1"], () => []),
  /mutatable source has no responsible Vitest test route: src\/orphan\.ts/,
);
const importChange = {
  source: "src/entry.ts",
  oldContents: 'import { value } from "./value";\n',
  newContents: 'import { value } from "./value.js";\n',
  oldStart: 1,
  oldLines: ['import { value } from "./value";'],
  newStart: 1,
  newLines: ['import { value } from "./value.js";'],
};
assert.deepEqual(
  classifyVerificationOnlyHunk(importChange, (path) => path === "src/value.ts"),
  {
    newFingerprint: "a18db7c61535ab83126eae98b1413e87f4d8de2b37be8e001da4c4f82b30f9e0",
    oldFingerprint: "2ca666ee56905b8939db0ea6e3a3207b1c7b4248239578b3982824618390bf77",
    range: "src/entry.ts:1-1",
    reason: "relative-import-appends-js",
    resolvedTarget: "src/value.ts",
  },
);
assert.equal(
  classifyVerificationOnlyHunk({
    source: "src/index.ts",
    oldContents: "",
    newContents: 'export * from "./capacity";\n',
    oldStart: 1,
    oldLines: [],
    newStart: 1,
    newLines: ['export * from "./capacity";'],
  }, (path) => path === "src/capacity.ts").reason,
  "new-relative-export-star",
);
assert.throws(
  () => classifyVerificationOnlyHunk({
    ...importChange,
    newContents: 'import { changedBinding } from "./value.js";\n',
    newLines: ['import { changedBinding } from "./value.js";'],
  }, (path) => path === "src/value.ts"),
  /must solely append \.js/,
);
assert.throws(
  () => classifyVerificationOnlyHunk(importChange, () => false),
  /resolves 0 targets/,
);
assert.throws(
  () => classifyVerificationOnlyHunk(importChange, () => true),
  /resolves 4 targets/,
);
assert.throws(
  () => classifyVerificationOnlyHunk({
    ...importChange,
    newLines: [importChange.newLines[0], "export const mixed = true;"],
  }, (path) => path === "src/value.ts"),
  /mixed or spans unsupported lines/,
);
assert.equal(requireNonzeroMutationReport({ files: { "src/a.ts": { mutants: [{ id: "1" }] } } }, "good"), 1);
assert.throws(
  () => requireNonzeroMutationReport({ files: { "src/a.ts": { mutants: [] } } }, "empty"),
  /scored mutation shard empty instrumented zero mutants/,
);
assert.throws(
  () => requireNonzeroMutationReport({ files: { "src/a.ts": { mutants: [{ id: "1", status: "Ignored" }] } } }, "ignored"),
  /scored mutation shard ignored has zero testable mutants/,
);
assert.deepEqual(
  readFreshMutationReport("report.json", 100, () => ({ mtimeMs: 101 }), () => '{"files":{}}'),
  { files: {} },
);
assert.throws(
  () => readFreshMutationReport("report.json", 100, () => ({ mtimeMs: 99 }), () => "{}"),
  /stale mutation report/,
);
assert.throws(
  () => readFreshMutationReport("report.json", 100, () => ({ mtimeMs: 101 }), () => "{"),
  /malformed mutation report/,
);
assert.throws(() => runVerificationCommands([], () => ({ status: 0 })), /has no commands/);
assert.throws(
  () => runVerificationCommands([["tool", ["test"]]], () => ({ status: 1 })),
  /verification command failed/,
);
assert.equal(
  runVerificationCommands([["tool", ["test"]]], () => ({ status: 0 })),
  1,
);
let downgradeClassifierCalls = 0;
assert.throws(
  () => verificationAuditsForReport(
    { files: { "src/a.ts": { mutants: [{ id: "1" }] } } },
    { id: "nonzero", mutate: ["src/a.ts:1-1"] },
    [],
    () => { downgradeClassifierCalls += 1; },
  ),
  /nonzero mutation shard nonzero cannot downgrade/,
);
assert.equal(downgradeClassifierCalls, 0);
const connectorVerification = verificationCommandsForSources(
  ["packages/connectors/src/action-planner.ts"],
  ["packages/connectors/src/action-planner.test.ts"],
);
assert.match(connectorVerification[2][1][2], /ERR_MODULE_NOT_FOUND/);
assert.match(connectorVerification[2][1][2], /dist\/module-wiring\/action-planner\.js/);
const contractsVerification = verificationCommandsForSources(
  ["packages/contracts/src/index.ts"],
  ["packages/contracts/src/capacity.test.ts"],
);
assert.deepEqual(contractsVerification[0], [
  "pnpm",
  ["--filter", "@smp/contracts", "build"],
]);
assert.ok(contractsVerification.at(-1)[1].includes("packages/contracts/src/capacity.test.ts"));
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

const fixtureRoot = mkdtempSync(join(tmpdir(), "smp-mutation-scope-"));
const source = "apps/web/src/modules/identity-access/users-roles-page.tsx";
const responsibleTest = "apps/web/src/modules/identity-access/user-admin-service.integration.test.ts";
const newSource = "src/new-capacity.ts";
const newSourceTest = "src/new-capacity.test.ts";
const deletionOnlySource = "src/deletion-only.ts";
const deletionOnlyTest = "src/deletion-only.test.ts";
const writeFixture = (path, contents) => {
  const absolutePath = join(fixtureRoot, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, "utf8");
};

let generated;
let generatedStatic;
let manifest;
let manifestText;
let configs;
try {
  execFileSync("git", ["init", "--quiet"], { cwd: fixtureRoot });
  execFileSync("git", ["config", "user.email", "mutation-scope@example.invalid"], { cwd: fixtureRoot });
  execFileSync("git", ["config", "user.name", "Mutation Scope Test"], { cwd: fixtureRoot });
  writeFixture("stryker.conf.json", JSON.stringify({ testFiles: [] }));
  writeFixture("vitest.mutation.config.mjs", "export default {};\n");
  writeFixture(source, [
    "export const first = 1;",
    "export const second = 2;",
    "export const third = 3;",
    "export const fourth = 4;",
    "export const fifth = 5;",
    "",
  ].join("\n"));
  writeFixture(responsibleTest, "export {};\n");
  writeFixture(deletionOnlySource, [
    "export const retained = 1;",
    "export const removed = 2;",
    "export const tail = 3;",
    "",
  ].join("\n"));
  writeFixture(deletionOnlyTest, "export {};\n");
  writeFixture("packages/db/src/schema.ts", "export const retained = 1;\nexport const capacity = 2;\n");
  writeFixture("packages/db/src/schema.test.ts", "export {};\n");
  execFileSync("git", ["add", "."], { cwd: fixtureRoot });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture base"], { cwd: fixtureRoot });
  const base = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: fixtureRoot,
    encoding: "utf8",
  }).trim();
  writeFixture(source, [
    "export const first = 1;",
    "export const second = 20;",
    "export const third = 3;",
    "export const fourth = 4;",
    "export const fifth = 50;",
    "",
  ].join("\n"));
  writeFixture(newSource, "export const seat = 1;\nexport const pool = 2;\n");
  writeFixture(newSourceTest, "export {};\n");
  writeFixture(deletionOnlySource, [
    "export const retained = 1;",
    "export const tail = 3;",
    "",
  ].join("\n"));
  writeFixture("packages/db/src/schema.ts", "export const retained = 1;\nexport const capacity = 20;\n");

  execFileSync(process.execPath, [
    fileURLToPath(new URL("./mutation-scope.mjs", import.meta.url)),
  ], {
    cwd: fixtureRoot,
    env: {
      ...process.env,
      MUTATION_BASE: base,
      MUTATION_SCOPE_DRY: "1",
    },
    stdio: "pipe",
  });

  manifestText = readFileSync(
    join(fixtureRoot, ".tmp/stryker-shards/manifest.json"),
    "utf8",
  );
  manifest = JSON.parse(manifestText);
  configs = manifest.shards.map(({ configPath }) => JSON.parse(
    readFileSync(join(fixtureRoot, configPath), "utf8"),
  ));
  generated = configs.find(({ testFiles }) => testFiles?.includes(responsibleTest));
  generatedStatic = configs.find(({ testRunner }) => testRunner === "command");
  execFileSync(process.execPath, [
    fileURLToPath(new URL("./mutation-scope.mjs", import.meta.url)),
  ], {
    cwd: fixtureRoot,
    env: {
      ...process.env,
      MUTATION_BASE: base,
      MUTATION_SCOPE_DRY: "1",
    },
    stdio: "pipe",
  });
  assert.equal(
    readFileSync(join(fixtureRoot, ".tmp/stryker-shards/manifest.json"), "utf8"),
    manifestText,
  );
} finally {
  rmSync(fixtureRoot, { force: true, recursive: true });
}

assert.equal(generated.coverageAnalysis, "off");
assert.deepEqual(generated.vitest, {
  configFile: "vitest.mutation.config.mjs",
  related: false,
});
assert.equal(generated.concurrency, 1);
assert.equal(generated.maxTestRunnerReuse, 1);
assert.equal(generated.thresholds.high, 80);
assert.equal(generated.thresholds.break, 80);
assert.deepEqual(generated.testFiles, [...generated.testFiles].sort());
assert.deepEqual(generated.testFiles, [
  responsibleTest,
]);
assert.deepEqual(generated.mutate, [
  `${source}:2-2`,
  `${source}:5-5`,
]);
assert.equal(manifest.shards.length, 3);
for (const [index, shard] of manifest.shards.entries()) {
  const config = configs[index];
  assert.equal(config.coverageAnalysis, "off");
  assert.equal(config.concurrency, 1);
  assert.equal(config.maxTestRunnerReuse, 1);
  assert.equal(config.thresholds.high, 80);
  assert.equal(config.thresholds.break, 80);
  assert.deepEqual(config.mutate, shard.mutate);
  assert.ok(config.reporters.includes("json"));
  assert.equal(config.jsonReporter.fileName, shard.jsonReportPath);
  if (shard.kind === "vitest") {
    assert.deepEqual(config.testFiles, shard.testFiles);
  } else {
    assert.equal("testFiles" in config, false);
  }
}
const assignedRanges = manifest.shards.flatMap(({ mutate }) => mutate);
assert.equal(new Set(assignedRanges).size, assignedRanges.length);
assert.deepEqual(
  assignedRanges.sort(),
  [
    `${source}:2-2`,
    `${source}:5-5`,
    `${newSource}:1-2`,
    "packages/db/src/schema.ts:2-2",
  ].sort(),
);
assert.equal(new Set(manifest.shards.map(({ configPath }) => configPath)).size, 3);
assert.equal(new Set(manifest.shards.map(({ tempDirName }) => tempDirName)).size, 3);
assert.equal(new Set(manifest.shards.map(({ reportPath }) => reportPath)).size, 3);
assert.equal(new Set(manifest.shards.map(({ jsonReportPath }) => jsonReportPath)).size, 3);
assert.deepEqual(
  manifest.shards.map(({ id }) => id),
  [...manifest.shards.map(({ id }) => id)].sort(),
);
assert.equal(generatedStatic.testRunner, "command");
assert.equal(generatedStatic.coverageAnalysis, "off");
assert.equal(generatedStatic.concurrency, 1);
assert.equal(generatedStatic.maxTestRunnerReuse, 1);
assert.equal(generatedStatic.thresholds.high, 80);
assert.equal(generatedStatic.thresholds.break, 80);
assert.equal("testFiles" in generatedStatic, false);
assert.deepEqual(generatedStatic.mutate, ["packages/db/src/schema.ts:2-2"]);
assert.equal(
  generatedStatic.commandRunner.command,
  "./apps/web/node_modules/.bin/vitest run --root packages/db --config vitest.config.ts src/schema.test.ts",
);
