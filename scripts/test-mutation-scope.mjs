#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DIRECT_TEST_ROUTES,
  classifyPageWiringBundle,
  classifyPoolSnapshotProjectionBundle,
  classifyVerificationOnlyHunk,
  groupRoutedMutationTargets,
  mutationCompatibleTestFiles,
  projectionEvidencePathForShard,
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

const poolProjectionSource = "packages/db/src/pool-snapshots.ts";
const poolProjectionNew = readFileSync(poolProjectionSource, "utf8");
const poolProjectionOld = poolProjectionNew
  .replace("  readonly effectiveFrom: string;\n", "")
  .replace("  effective_from: string;\n", "")
  .replace("            capacity.effective_from::text AS effective_from,\n", "")
  .replace(
    "              vac.license_type_id, vac.purchased_qty, vac.effective_from",
    "              vac.license_type_id, vac.purchased_qty",
  )
  .replace("    effectiveFrom: row.effective_from,\n", "");
const poolProjectionChanges = [
  [6, [], ["  readonly effectiveFrom: string;"]],
  [22, [], ["  effective_from: string;"]],
  [51, [], ["            capacity.effective_from::text AS effective_from,"]],
  [57, ["              vac.license_type_id, vac.purchased_qty"], [
    "              vac.license_type_id, vac.purchased_qty, vac.effective_from",
  ]],
  [107, [], ["    effectiveFrom: row.effective_from,"]],
].map(([newStart, oldLines, newLines]) => ({
  source: poolProjectionSource,
  oldContents: poolProjectionOld,
  newContents: poolProjectionNew,
  oldStart: newStart,
  oldLines,
  newStart,
  newLines,
}));
assert.deepEqual(
  classifyPoolSnapshotProjectionBundle(poolProjectionChanges),
  {
    faultIds: [
      "outer-projection-removed-or-renamed",
      "lateral-field-removed",
      "row-mapping-wrong",
      "operating-date-input-replaced",
      "operating-date-constant",
    ],
    ranges: [
      `${poolProjectionSource}:6-6`,
      `${poolProjectionSource}:22-22`,
      `${poolProjectionSource}:51-51`,
      `${poolProjectionSource}:57-57`,
      `${poolProjectionSource}:107-107`,
    ],
    reason: "verification-only:database-projection-bundle",
    source: poolProjectionSource,
  },
);
const poolProjectionRanges = poolProjectionChanges.map((change) =>
  `${change.source}:${change.newStart}-${change.newStart + change.newLines.length - 1}`);
assert.equal(
  verificationAuditsForReport(
    { files: {} },
    {
      id: "pool-projection",
      mutate: poolProjectionRanges,
      sources: [poolProjectionSource],
    },
    poolProjectionChanges,
  )[0].reason,
  "verification-only:database-projection-bundle",
);
assert.throws(
  () => verificationAuditsForReport(
    { files: {} },
    {
      id: "pool-projection-incomplete",
      mutate: poolProjectionRanges.slice(1),
      sources: [poolProjectionSource],
    },
    poolProjectionChanges,
  ),
  /incomplete or extra mutation range set/,
);
for (const mutate of [
  ["incomplete", (changes) => changes.slice(1)],
  ["duplicate", (changes) => [...changes, changes[0]]],
  ["cast", (changes) => changes.map((change) => ({
    ...change,
    newContents: change.newContents.replace(
      "capacity.effective_from::text AS effective_from",
      "capacity.effective_from AS effective_from",
    ),
  }))],
  ["default", (changes) => changes.map((change) => ({
    ...change,
    newContents: change.newContents.replace(
      "effectiveFrom: row.effective_from",
      "effectiveFrom: row.effective_from ?? '2026-08-01'",
    ),
  }))],
  ["interpolation", (changes) => changes.map((change) => ({
    ...change,
    newContents: change.newContents.replace(
      "capacity.effective_from::text AS effective_from",
      "${effectiveFromProjection}",
    ),
  }))],
  ["wrong scope", (changes) => changes.map((change) => ({
    ...change,
    source: "packages/db/src/other.ts",
  }))],
].map(([, mutate]) => mutate)) {
  assert.throws(
    () => classifyPoolSnapshotProjectionBundle(mutate(poolProjectionChanges)),
    /database projection/,
  );
}

const pageBundle = (source, deltas) => {
  const newContents = readFileSync(source, "utf8");
  let oldContents = newContents;
  for (const delta of [...deltas].reverse()) {
    oldContents = oldContents.replace(
      `${delta.newLines.join("\n")}\n`,
      delta.oldLines.length === 0 ? "" : `${delta.oldLines.join("\n")}\n`,
    );
  }
  return deltas.map((delta) => ({
    source,
    oldContents,
    newContents,
    oldLines: delta.oldLines,
    oldStart: delta.line,
    newLines: delta.newLines,
    newStart: delta.line,
  }));
};
const poolsPageSource = "apps/web/src/app/(authenticated)/cupos/page.tsx";
const poolsPageChanges = pageBundle(poolsPageSource, [
  {
    line: 4,
    oldLines: ['import { PoolCards, type PoolCardsLabels } from "@/components/pools/pool-cards";'],
    newLines: ['import { PoolCards } from "@/components/pools/pool-cards";'],
  },
  {
    line: 9,
    oldLines: [],
    newLines: ['import { createPoolCardsLabels } from "./labels";', ""],
  },
  {
    line: 23,
    oldLines: [
      "  const labels: PoolCardsLabels = {",
      '    assigned: t("assigned"),',
      '    attention: t("attention"),',
      '    automated: t("automated"),',
      '    available: t("available"),',
      '    discrepancy: t("discrepancy"),',
      '    emptyDescription: t("emptyDescription"),',
      '    emptyTitle: t("emptyTitle"),',
      '    floor: t("floor"),',
      '    mode: t("mode"),',
      '    orchestration: t("orchestration"),',
      '    pending: t("pending"),',
      '    purchased: t("purchased"),',
      '    renewal: t("renewal"),',
      "  };",
    ],
    newLines: ["  const labels = createPoolCardsLabels(t);"],
  },
]);
const exceptionsPageSource = "apps/web/src/app/(authenticated)/excepciones/page.tsx";
const exceptionsPageChanges = pageBundle(exceptionsPageSource, [
  {
    line: 12,
    oldLines: [],
    newLines: [
      "import {",
      "  createBlockedRequestsLabels,",
      "  toBlockedRequestItem,",
      '} from "./labels";',
      "",
    ],
  },
  {
    line: 124,
    oldLines: [
      "            items={blocked.items.map((request) => ({",
      "              companyName: request.companyName,",
      "              daysBlocked: request.daysBlocked,",
      "              id: request.id,",
      "              licenseTypeName: request.licenseTypeName,",
      "              neededBy: request.neededBy,",
      "              personName: request.personName,",
      "              requestNo: request.requestNo,",
      "              vendorAccountName: request.vendorAccountName,",
      "            }))}",
      "            labels={{",
      '              company: t("blocked.company"),',
      '              daysBlocked: t("blocked.daysBlocked"),',
      '              empty: t("blocked.empty"),',
      '              neededBy: t("blocked.neededBy"),',
      '              noDate: t("blocked.noDate"),',
      '              organization: t("blocked.organization"),',
      '              request: t("blocked.request"),',
      '              status: t("blocked.status"),',
      '              statusBlocked: t("blocked.statusBlocked"),',
      '              viewPools: t("blocked.viewPools"),',
      "            }}",
    ],
    newLines: [
      "            items={blocked.items.map(toBlockedRequestItem)}",
      "            labels={createBlockedRequestsLabels(t)}",
    ],
  },
]);
for (const changes of [poolsPageChanges, exceptionsPageChanges]) {
  assert.equal(
    classifyPageWiringBundle(changes).reason,
    "verification-only:page-wiring-bundle",
  );
  const ranges = changes.map((change) =>
    `${change.source}:${change.newStart}-${change.newStart + change.newLines.length - 1}`);
  assert.equal(
    verificationAuditsForReport(
      { files: {} },
      { id: "page", mutate: ranges, sources: [changes[0].source] },
      changes,
    )[0].source,
    changes[0].source,
  );
}
for (const [before, after] of [
  ['from "./labels"', 'from "./wrong-labels"'],
  ["createPoolCardsLabels(t)", "createPoolCardsLabels(locale)"],
  ["const labels =", "const wrongLabels ="],
  ["labels={labels}", "labels={wrongLabels}"],
]) {
  assert.throws(
    () => classifyPageWiringBundle(poolsPageChanges.map((change) => ({
      ...change,
      newContents: change.newContents.replace(before, after),
      newLines: change.newLines.map((line) => line.replace(before, after)),
    }))),
    /page wiring/,
  );
}
for (const [before, after] of [
  ["toBlockedRequestItem", "wrongRequestAdapter"],
  ["createBlockedRequestsLabels(t)", "createBlockedRequestsLabels(locale)"],
  ["items={blocked.items.map(toBlockedRequestItem)}", "items={blocked.items}"],
  ["labels={createBlockedRequestsLabels(t)}", "labels={undefined}"],
]) {
  assert.throws(
    () => classifyPageWiringBundle(exceptionsPageChanges.map((change) => ({
      ...change,
      newContents: change.newContents.replaceAll(before, after),
      newLines: change.newLines.map((line) => line.replaceAll(before, after)),
    }))),
    /page wiring/,
  );
}
assert.throws(
  () => classifyVerificationOnlyHunk({
    source: "src/index.ts",
    oldContents: "",
    newContents: 'export * from "./capacity";\nexport const mixed = true;\n',
    oldStart: 1,
    oldLines: [],
    newStart: 1,
    newLines: ['export * from "./capacity";', "export const mixed = true;"],
  }, (path) => path === "src/capacity.ts"),
  /exact module declarations/,
);

assert.deepEqual(
  DIRECT_TEST_ROUTES["apps/web/src/modules/vendor-catalog/capacity-recovery-outbox.ts"],
  ["apps/web/src/modules/vendor-catalog/capacity-service.integration.test.ts"],
);
assert.deepEqual(
  DIRECT_TEST_ROUTES["apps/web/src/app/(authenticated)/cupos/labels.ts"],
  ["apps/web/src/app/(authenticated)/cupos/labels.test.ts"],
);
assert.deepEqual(
  DIRECT_TEST_ROUTES["apps/web/src/app/(authenticated)/excepciones/labels.ts"],
  ["apps/web/src/app/(authenticated)/excepciones/labels.test.ts"],
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
  DIRECT_TEST_ROUTES["apps/web/src/modules/vendor-catalog/actions/manage-capacity-server-actions-factory.ts"],
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
assert.deepEqual(
  classifyVerificationOnlyHunk({
    source: "src/index.ts",
    oldContents: "",
    newContents: 'export * from "./capacity";\n',
    oldStart: 1,
    oldLines: [],
    newStart: 1,
    newLines: ['export * from "./capacity";'],
  }, (path) => path === "src/capacity.ts"),
  {
    newFingerprint: "e44b2298ad9cbc536267c4f743fcf3f0fe02216818a8f15b88155de78179ddf3",
    oldFingerprint: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    range: "src/index.ts:1-1",
    reason: "new-relative-export-stars",
    resolvedTarget: ["src/capacity.ts"],
  },
);
assert.deepEqual(
  classifyVerificationOnlyHunk({
    source: "packages/contracts/src/index.ts",
    oldContents: "",
    newContents: [
      'export * from "./capacity";',
      'export * from "./identity-access";',
      "",
    ].join("\n"),
    oldStart: 1,
    oldLines: [],
    newStart: 1,
    newLines: [
      'export * from "./capacity";',
      'export * from "./identity-access";',
    ],
  }, (path) => new Set([
    "packages/contracts/src/capacity.ts",
    "packages/contracts/src/identity-access.ts",
  ]).has(path)).resolvedTarget,
  [
    "packages/contracts/src/capacity.ts",
    "packages/contracts/src/identity-access.ts",
  ],
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
const symlinkPackage = mkdtempSync(join(process.cwd(), "packages/contracts/.mutation-symlink-"));
const symlinkOutside = mkdtempSync(join(tmpdir(), "smp-mutation-symlink-outside-"));
try {
  writeFileSync(join(symlinkOutside, "target.ts"), "export const value = 1;\n", "utf8");
  symlinkSync(join(symlinkOutside, "target.ts"), join(symlinkPackage, "linked.ts"));
  const symlinkSource = relative(process.cwd(), join(symlinkPackage, "index.ts"));
  assert.throws(
    () => classifyVerificationOnlyHunk({
      source: symlinkSource,
      oldContents: 'import { value } from "./linked";\n',
      newContents: 'import { value } from "./linked.js";\n',
      oldStart: 1,
      oldLines: ['import { value } from "./linked";'],
      newStart: 1,
      newLines: ['import { value } from "./linked.js";'],
    }),
    /escapes its package/,
  );
} finally {
  rmSync(symlinkPackage, { force: true, recursive: true });
  rmSync(symlinkOutside, { force: true, recursive: true });
}
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
assert.deepEqual(
  verificationCommandsForSources(
    [poolProjectionSource],
    ["packages/db/src/pool-snapshots.test.ts"],
    { evidencePath: ".tmp/pool-evidence.json" },
  ),
  [[
    "node",
    ["scripts/verify-pool-snapshot-projection.mjs", ".tmp/pool-evidence.json"],
  ]],
);
assert.equal(
  projectionEvidencePathForShard({
    id: "vitest-projection",
    provenance: { runHash: "1234567890abcdef" },
    sources: [poolProjectionSource],
  }),
  ".tmp/stryker-shards/vitest-projection-1234567890ab-projection.json",
);
assert.equal(
  projectionEvidencePathForShard({
    id: "vitest-other",
    provenance: { runHash: "1234567890abcdef" },
    sources: ["packages/db/src/schema.ts"],
  }),
  undefined,
);
assert.throws(
  () => verificationCommandsForSources(
    [poolProjectionSource],
    ["packages/db/src/pool-snapshots.test.ts"],
  ),
  /requires an evidence path/,
);
assert.deepEqual(
  verificationCommandsForSources(
    [poolsPageSource],
    ["apps/web/src/app/(authenticated)/cupos/page.test.ts"],
  ),
  [
    [
      "./apps/web/node_modules/.bin/vitest",
      [
        "run",
        "--config",
        "vitest.mutation.config.mjs",
        "apps/web/src/app/(authenticated)/cupos/page.test.ts",
      ],
    ],
    ["pnpm", ["--filter", "smp-web", "type-check"]],
    ["pnpm", ["--filter", "smp-web", "build"]],
  ],
);
assert.equal(
  verifyContractsBarrelSource([
    'export * from "./capacity";',
    'export * from "./identity-access";',
    "",
  ].join("\n"), (path) => new Set([
    "packages/contracts/src/capacity.ts",
    "packages/contracts/src/identity-access.ts",
  ]).has(path)).length,
  2,
);
assert.throws(
  () => verifyContractsBarrelSource("", () => true),
  /exactly one \.\/capacity export; found 0/,
);
assert.throws(
  () => verifyContractsBarrelSource(
    'export * from "./capacity";\n',
    (path) => path === "packages/contracts/src/capacity.ts",
  ),
  /exactly one \.\/identity-access export; found 0/,
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
