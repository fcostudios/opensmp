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
  validateMutationReportIdentity,
  verificationCommandsForSources,
  verificationAuditsForReport,
  verifyContractsBarrelSource,
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
assert.deepEqual(
  DIRECT_TEST_ROUTES["apps/web/src/modules/identity-access/provider-operation-repository.ts"],
  [
    "apps/web/src/modules/identity-access/repository.integration.test.ts",
    "apps/web/src/modules/identity-access/user-admin-service.integration.test.ts",
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
assert.deepEqual(
  classifyVerificationOnlyHunk({
    source: "packages/connectors/src/index.ts",
    oldContents: [
      'export * from "./contracts";',
      'export * from "./dispatch";',
      'export * from "./action-planner";',
      "",
    ].join("\n"),
    newContents: [
      'export * from "./contracts.js";',
      'export * from "./dispatch.js";',
      'export * from "./action-planner.js";',
      "",
    ].join("\n"),
    oldStart: 1,
    oldLines: [
      'export * from "./contracts";',
      'export * from "./dispatch";',
      'export * from "./action-planner";',
    ],
    newStart: 1,
    newLines: [
      'export * from "./contracts.js";',
      'export * from "./dispatch.js";',
      'export * from "./action-planner.js";',
    ],
  }, (path) => new Set([
    "packages/connectors/src/contracts.ts",
    "packages/connectors/src/dispatch.ts",
    "packages/connectors/src/action-planner.ts",
  ]).has(path)),
  {
    newFingerprint: "b5cbd2b0944982456145e53ad45bf1f989e83441639f5ad47bd0dd780809bdcf",
    oldFingerprint: "fa0ea713423d119b4eacb83081ba04ba7f03a1b9c104b019a171b2a41eb89956",
    range: "packages/connectors/src/index.ts:1-3",
    reason: "relative-export-stars-append-js",
    resolvedTarget: [
      "packages/connectors/src/contracts.ts",
      "packages/connectors/src/dispatch.ts",
      "packages/connectors/src/action-planner.ts",
    ],
  },
);
assert.throws(
  () => classifyVerificationOnlyHunk({
    ...importChange,
    newContents: 'import { changedBinding } from "./value.js";\n',
    newLines: ['import { changedBinding } from "./value.js";'],
  }, (path) => path === "src/value.ts"),
  /must solely insert \.js/,
);
assert.throws(
  () => classifyVerificationOnlyHunk({
    ...importChange,
    oldContents: "import { value } from './value';\n",
    newContents: 'import { value } from "./value.js";\n',
    oldLines: ["import { value } from './value';"],
    newLines: ['import { value } from "./value.js";'],
  }, (path) => path === "src/value.ts"),
  /unchanged closing quote/,
);
assert.throws(
  () => classifyVerificationOnlyHunk({
    ...importChange,
    newContents: 'import { value } from "./value.mjs";\n',
    newLines: ['import { value } from "./value.mjs";'],
  }, (path) => path === "src/value.ts"),
  /solely insert \.js/,
);
assert.throws(
  () => classifyVerificationOnlyHunk(importChange, () => false),
  /resolves 0 targets/,
);
assert.throws(
  () => classifyVerificationOnlyHunk({
    ...importChange,
    oldContents: 'import data from "./value" with { type: "json" };\n',
    newContents: 'import data from "./value.js" with { type: "json" };\n',
    oldLines: ['import data from "./value" with { type: "json" };'],
    newLines: ['import data from "./value.js" with { type: "json" };'],
  }, (path) => path === "src/value.ts"),
  /cannot use attributes or assertions/,
);
assert.throws(
  () => classifyVerificationOnlyHunk({
    ...importChange,
    oldContents: 'import { value } from "../outside";\n',
    newContents: 'import { value } from "../outside.js";\n',
    oldLines: ['import { value } from "../outside";'],
    newLines: ['import { value } from "../outside.js";'],
  }, (path) => path === "outside.ts"),
  /escapes its package/,
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
const identityConfig = '{"mutate":["src/a.ts:2-3"]}\n';
const identityShard = {
  configHash: "158bf6b7b7025c2ac096b0a0b3babc3cdb188a2fbec24a6372c9f4b90386d07a",
  configPath: ".tmp/shard.json",
  contentHashes: {
    "src/a.ts": "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
  },
  id: "identity",
  jsonReportPath: "reports/identity-run.json",
  mutate: ["src/a.ts:2-3"],
  sources: ["src/a.ts"],
};
const identityReport = {
  config: {
    configFile: identityShard.configPath,
    jsonReporter: { fileName: identityShard.jsonReportPath },
    mutate: identityShard.mutate,
  },
  files: {
    "src/a.ts": {
      mutants: [{ location: { start: { line: 2 }, end: { line: 3 } } }],
      source: "hello world",
    },
  },
};
assert.equal(
  validateMutationReportIdentity(identityReport, identityShard, identityConfig, () => "hello world"),
  true,
);
assert.throws(
  () => validateMutationReportIdentity(
    { ...identityReport, config: { ...identityReport.config, mutate: ["src/a.ts:1-9"] } },
    identityShard,
    identityConfig,
    () => "hello world",
  ),
  /config identity mismatch/,
);
assert.throws(
  () => validateMutationReportIdentity({
    ...identityReport,
    files: {
      "src/a.ts": {
        mutants: [{ location: { start: { line: 4 }, end: { line: 4 } } }],
        source: "hello world",
      },
    },
  }, identityShard, identityConfig, () => "hello world"),
  /outside requested ranges/,
);
assert.throws(
  () => validateMutationReportIdentity({
    ...identityReport,
    files: {
      "src/wrong.ts": {
        mutants: [{ location: { start: { line: 2 }, end: { line: 2 } } }],
        source: "hello world",
      },
    },
  }, identityShard, identityConfig, () => "hello world"),
  /source identity mismatch/,
);
assert.throws(
  () => validateMutationReportIdentity(identityReport, identityShard, identityConfig, () => "wrong"),
  /source content hash mismatch/,
);
const connectorVerification = verificationCommandsForSources(
  ["packages/connectors/src/action-planner.ts"],
  ["packages/connectors/src/action-planner.test.ts"],
);
assert.match(connectorVerification[2][1][2], /ERR_MODULE_NOT_FOUND/);
assert.match(connectorVerification[2][1][2], /index\.js/);
assert.match(connectorVerification[2][1][2], /public exports differ from exact module union/);
const contractsVerification = verificationCommandsForSources(
  ["packages/contracts/src/index.ts"],
  ["packages/contracts/src/capacity.test.ts"],
);
assert.deepEqual(contractsVerification[0], [
  "pnpm",
  ["--filter", "@smp/contracts", "build"],
]);
assert.match(contractsVerification[1][1][2], /negative control did not fail/);
assert.ok(contractsVerification.at(-1)[1].includes("packages/contracts/src/capacity.test.ts"));
assert.equal(
  verifyContractsBarrelSource(
    'export * from "./capacity";\n',
    (path) => path === "packages/contracts/src/capacity.ts",
  ),
  "packages/contracts/src/capacity.ts",
);
assert.throws(
  () => verifyContractsBarrelSource("", () => true),
  /exactly one capacity export; found 0/,
);
assert.throws(
  () => verifyContractsBarrelSource('export * from "./wrong";\n', () => true),
  /exactly one capacity export; found 0/,
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
let fixtureBase;
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
  fixtureBase = base;
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
assert.equal(manifest.base, fixtureBase);
assert.match(manifest.head, /^[0-9a-f]{40}$/);
assert.match(manifest.worktreeHash, /^[0-9a-f]{64}$/);
for (const [index, shard] of manifest.shards.entries()) {
  const config = configs[index];
  assert.equal(config.coverageAnalysis, "off");
  assert.equal(config.concurrency, 1);
  assert.equal(config.maxTestRunnerReuse, 1);
  assert.equal(config.thresholds.high, 80);
  assert.equal(config.thresholds.break, 80);
  assert.deepEqual(config.mutate, shard.mutate);
  assert.equal(shard.classification, "pending");
  assert.equal(shard.mutantCount, null);
  assert.equal(shard.result, "pending");
  assert.equal(shard.reportHash, null);
  assert.match(shard.configHash, /^[0-9a-f]{64}$/);
  assert.match(shard.provenance.runHash, /^[0-9a-f]{64}$/);
  assert.ok(shard.jsonReportPath.includes(shard.provenance.runHash.slice(0, 12)));
  assert.ok(shard.reportPath.includes(shard.provenance.runHash.slice(0, 12)));
  assert.equal(shard.provenance.resolvedBase, fixtureBase);
  assert.deepEqual(shard.provenance.toolVersions, manifest.toolVersions);
  for (const source of shard.sources) assert.match(shard.contentHashes[source], /^[0-9a-f]{64}$/);
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
