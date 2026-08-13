#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
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
  requireNonzeroStaticShard,
  requireRoutedTestFiles,
  routedTestFiles,
  runVerificationCommands,
  validateMutationReportIdentity,
  verificationCommandsForSources,
  verificationAuditsForReport,
  verifyContractsBarrelSource,
  runMutationScope,
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
for (const kind of ["schema-static", "vitest-config-static"]) {
  assert.throws(
    () => requireNonzeroStaticShard(kind, 0, `${kind}-empty`),
    new RegExp(`scored mutation shard ${kind}-empty instrumented zero mutants`),
  );
  assert.equal(requireNonzeroStaticShard(kind, 1, `${kind}-nonzero`), undefined);
}
assert.equal(requireNonzeroStaticShard("vitest", 0, "ordinary-zero"), undefined);
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
let generatedSchemaStatic;
let generatedVitestStatic;
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
  writeFixture("apps/web/vitest.config.ts", [
    ...Array.from({ length: 20 }, (_, index) => `// config line ${index + 1}`),
    'export const include = ["src/**/*.{test,spec}.{ts,tsx}"];',
    "",
  ].join("\n"));
  writeFixture("apps/web/next.config.test.ts", "export {};\n");
  writeFixture("apps/web/vitest.static-contract.config.mjs", "export default {};\n");
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
  writeFixture("apps/web/vitest.config.ts", [
    ...Array.from({ length: 20 }, (_, index) => `// config line ${index + 1}`),
    'export const include = ["src/**/*.{test,spec}.{ts,tsx}", "next.config.test.ts"];',
    "",
  ].join("\n"));

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
  generatedSchemaStatic = configs.find(({ commandRunner }) =>
    commandRunner?.command.includes("--root packages/db"));
  generatedVitestStatic = configs.find(({ commandRunner }) =>
    commandRunner?.command.includes("vitest.static-contract.config.mjs"));
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
  assert.equal(existsSync(join(fixtureRoot, "reports/mutation-performance")), false);
  assert.equal(existsSync(join(fixtureRoot, ".git/ledger-mutation-cache")), false);
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
assert.equal(manifest.shards.length, 4);
assert.equal(manifest.provenance.base, fixtureBase);
assert.equal(manifest.provenance.baseRef, fixtureBase);
assert.match(manifest.provenance.head, /^[0-9a-f]{40}$/);
assert.match(manifest.provenance.worktreeHash, /^[0-9a-f]{64}$/);
assert.deepEqual(Object.keys(manifest).sort(), ["provenance", "shards", "toolVersions"]);
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
  assert.equal("provenance" in shard, false);
  assert.equal(shard.cacheDecision, "pending");
  assert.equal(shard.durationMs, null);
  assert.equal(shard.priorDurationMs, null);
  assert.equal(shard.evidenceKey, null);
  assert.deepEqual(shard.dependencyHashes, {});
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
    "apps/web/vitest.config.ts:21-21",
    "packages/db/src/schema.ts:2-2",
  ].sort(),
);
assert.equal(new Set(manifest.shards.map(({ configPath }) => configPath)).size, 4);
assert.equal(new Set(manifest.shards.map(({ tempDirName }) => tempDirName)).size, 4);
assert.equal(new Set(manifest.shards.map(({ reportPath }) => reportPath)).size, 4);
assert.equal(new Set(manifest.shards.map(({ jsonReportPath }) => jsonReportPath)).size, 4);
assert.deepEqual(
  manifest.shards.map(({ id }) => id),
  [...manifest.shards.map(({ id }) => id)].sort(),
);
assert.equal(generatedSchemaStatic.testRunner, "command");
assert.equal(generatedSchemaStatic.coverageAnalysis, "off");
assert.equal(generatedSchemaStatic.concurrency, 1);
assert.equal(generatedSchemaStatic.maxTestRunnerReuse, 1);
assert.equal(generatedSchemaStatic.thresholds.high, 80);
assert.equal(generatedSchemaStatic.thresholds.break, 80);
assert.equal("testFiles" in generatedSchemaStatic, false);
assert.deepEqual(generatedSchemaStatic.mutate, ["packages/db/src/schema.ts:2-2"]);
assert.equal(
  generatedSchemaStatic.commandRunner.command,
  "./apps/web/node_modules/.bin/vitest run --root packages/db --config vitest.config.ts src/schema.test.ts",
);
assert.equal(generatedVitestStatic.testRunner, "command");
assert.equal(generatedVitestStatic.coverageAnalysis, "off");
assert.equal(generatedVitestStatic.concurrency, 1);
assert.equal(generatedVitestStatic.maxTestRunnerReuse, 1);
assert.equal(generatedVitestStatic.thresholds.high, 80);
assert.equal(generatedVitestStatic.thresholds.break, 80);
assert.equal("testFiles" in generatedVitestStatic, false);
assert.deepEqual(generatedVitestStatic.mutate, ["apps/web/vitest.config.ts:21-21"]);
assert.equal(
  generatedVitestStatic.commandRunner.command,
  "./apps/web/node_modules/.bin/vitest run --root apps/web --config vitest.static-contract.config.mjs next.config.test.ts",
);
const vitestStaticShard = manifest.shards.find(({ kind }) => kind === "vitest-config-static");
assert.deepEqual(vitestStaticShard.sources, ["apps/web/vitest.config.ts"]);
assert.deepEqual(vitestStaticShard.testFiles, ["apps/web/next.config.test.ts"]);
assert.deepEqual(vitestStaticShard.mutate, ["apps/web/vitest.config.ts:21-21"]);
assert.match(vitestStaticShard.contentHashes["apps/web/vitest.config.ts"], /^[0-9a-f]{64}$/);
assert.equal("provenance" in vitestStaticShard, false);

const cacheFixtureRoot = mkdtempSync(join(tmpdir(), "smp-mutation-cache-runner-"));
const cacheSource = "packages/db/src/provisioning-routing.ts";
const cacheTest = "packages/db/src/provisioning-routing.test.ts";
const cacheWrite = (path, contents) => {
  const destination = join(cacheFixtureRoot, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents, "utf8");
};
const cacheRun = async (overrides = {}) => {
  let executions = 0;
  const result = await runMutationScope({
    cwd: cacheFixtureRoot,
    env: { MUTATION_BASE: cacheFixtureBase, ...overrides.env },
    toolVersions: overrides.toolVersions ?? {
      node: "22.0.0",
      pnpm: "10.0.0",
      stryker: "9.0.0",
      typescript: "5.0.0",
      vitest: "3.0.0",
    },
    runtimeProfileProvider: overrides.runtimeProfileProvider ?? (() => ({
      arch: "x64",
      locale: "en-US",
      platform: "linux",
      timezone: "UTC",
      databaseDriver: "postgres",
      databaseServerVersion: "16.4",
      schemaFingerprint: "a".repeat(64),
    })),
    beforeEvidence: overrides.beforeEvidence,
    signalProcess: overrides.signalProcess,
    executeShard: ({ shard }) => {
      executions += 1;
      const mutantLine = Number(/:(\d+)-/.exec(shard.mutate[0])?.[1]);
      const report = {
        config: {
          configFile: shard.configPath,
          jsonReporter: { fileName: shard.jsonReportPath },
          mutate: shard.mutate,
        },
        files: Object.fromEntries(shard.sources.map((sourcePath) => [sourcePath, {
          source: readFileSync(join(cacheFixtureRoot, sourcePath), "utf8"),
          mutants: [{
            id: "0",
            location: { start: { line: mutantLine }, end: { line: mutantLine } },
            status: "Killed",
          }],
        }])),
      };
      cacheWrite(shard.jsonReportPath, `${JSON.stringify(report)}\n`);
      cacheWrite(shard.reportPath, "<html>validated mutation evidence</html>\n");
      return { status: overrides.executorStatus ?? 0 };
    },
  });
  return { executions, result };
};
let cacheFixtureBase;
try {
  execFileSync("git", ["init", "--quiet"], { cwd: cacheFixtureRoot });
  execFileSync("git", ["config", "user.email", "mutation-cache@example.invalid"], { cwd: cacheFixtureRoot });
  execFileSync("git", ["config", "user.name", "Mutation Cache Test"], { cwd: cacheFixtureRoot });
  cacheWrite("package.json", JSON.stringify({ name: "fixture", private: true }));
  cacheWrite("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  cacheWrite("stryker.conf.json", JSON.stringify({ testFiles: [] }));
  cacheWrite("vitest.mutation.config.mjs", "export default {};\n");
  cacheWrite("scripts/mutation-scope.mjs", 'import "node:fs";\nexport const runnerIdentity = 1;\n');
  cacheWrite("scripts/mutation-evidence/fingerprint.mjs", "export const fingerprintIdentity = 1;\n");
  cacheWrite("scripts/mutation-evidence/cache.mjs", "export const cacheIdentity = 1;\n");
  cacheWrite("scripts/mutation-evidence/performance.mjs", "export const performanceIdentity = 1;\n");
  cacheWrite("scripts/dependency.mjs", "export const dependency = 1;\n");
  cacheWrite(cacheSource, 'import "../../../scripts/dependency.mjs";\nexport const rolesPage = 1;\n');
  cacheWrite(cacheTest, "export {};\n");
  execFileSync("git", ["add", "."], { cwd: cacheFixtureRoot });
  execFileSync("git", ["commit", "--quiet", "-m", "cache base"], { cwd: cacheFixtureRoot });
  cacheFixtureBase = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: cacheFixtureRoot,
    encoding: "utf8",
  }).trim();
  cacheWrite(cacheSource, 'import "../../../scripts/dependency.mjs";\nexport const rolesPage = 2;\n');

  const cold = await cacheRun();
  assert.equal(cold.executions, 1);
  assert.equal(cold.result.manifest.shards[0].cacheDecision, "executed");
  assert.equal(cold.result.performance.shards[0].classification, "scored");
  assert.match(cold.result.manifest.shards[0].evidenceKey, /^[a-f0-9]{64}$/);
  assert.ok(Object.keys(cold.result.manifest.shards[0].dependencyHashes).length > 0);

  const warm = await cacheRun();
  assert.equal(warm.executions, 0);
  assert.equal(warm.result.manifest.shards[0].cacheDecision, "reused");
  assert.equal(warm.result.performance.shards[0].classification, "scored");
  assert.equal(warm.result.manifest.shards[0].priorDurationMs, cold.result.manifest.shards[0].durationMs);
  assert.equal(warm.result.manifest.shards[0].configHash, cold.result.manifest.shards[0].configHash);
  assert.equal(warm.result.manifest.shards[0].evidenceKey, cold.result.manifest.shards[0].evidenceKey);
  assert.notEqual(warm.result.manifest.shards[0].reportPath, cold.result.manifest.shards[0].reportPath);
  assert.notEqual(warm.result.manifest.shards[0].tempDirName, cold.result.manifest.shards[0].tempDirName);

  execFileSync("git", ["add", cacheSource], { cwd: cacheFixtureRoot });
  execFileSync("git", ["commit", "--quiet", "-m", "provenance only"], { cwd: cacheFixtureRoot });
  const committed = await cacheRun();
  assert.equal(committed.executions, 0);
  assert.equal(committed.result.manifest.shards[0].cacheDecision, "reused");
  assert.equal(committed.result.manifest.shards[0].evidenceKey, cold.result.manifest.shards[0].evidenceKey);
  cacheWrite("docs/unrelated.md", "metadata only\n");
  const unrelatedDocumentation = await cacheRun();
  assert.equal(unrelatedDocumentation.executions, 0);
  assert.equal(unrelatedDocumentation.result.manifest.shards[0].evidenceKey, cold.result.manifest.shards[0].evidenceKey);
  rmSync(join(cacheFixtureRoot, "docs/unrelated.md"));

  for (const [path, contents] of [
    [cacheSource, 'import "../../../scripts/dependency.mjs";\nexport const rolesPage = 3;\n'],
    [cacheTest, "export const responsible = true;\n"],
    ["stryker.conf.json", JSON.stringify({ testFiles: [], timeoutMS: 1234 })],
    ["scripts/dependency.mjs", "export const dependency = 2;\n"],
    ["pnpm-lock.yaml", "lockfileVersion: '9.0'\n# changed\n"],
    ["scripts/mutation-scope.mjs", 'import "node:fs";\nexport const runnerIdentity = 2;\n'],
    ["scripts/mutation-evidence/fingerprint.mjs", "export const fingerprintIdentity = 2;\n"],
    ["scripts/mutation-evidence/cache.mjs", "export const cacheIdentity = 2;\n"],
    ["scripts/mutation-evidence/performance.mjs", "export const performanceIdentity = 2;\n"],
  ]) {
    const existed = existsSync(join(cacheFixtureRoot, path));
    const before = existed ? readFileSync(join(cacheFixtureRoot, path), "utf8") : null;
    cacheWrite(path, contents);
    const sourceBeforeRun = readFileSync(join(cacheFixtureRoot, cacheSource), "utf8");
    const miss = await cacheRun();
    assert.equal(miss.executions, 1, `${path} changes invalidate cached evidence`);
    if (path === "scripts/dependency.mjs") {
      assert.equal(readFileSync(join(cacheFixtureRoot, cacheSource), "utf8"), sourceBeforeRun);
    }
    if (existed) cacheWrite(path, before);
    else rmSync(join(cacheFixtureRoot, path), { force: true });
  }
  assert.equal((await cacheRun({
    toolVersions: {
      node: "22.0.1", pnpm: "10.0.0", stryker: "9.0.0", typescript: "5.0.0", vitest: "3.0.0",
    },
  })).executions, 1);
  assert.equal((await cacheRun({
    runtimeProfileProvider: () => ({
      arch: "x64", locale: "en-US", platform: "linux", timezone: "UTC",
      databaseDriver: "postgres", databaseServerVersion: "17.0",
      schemaFingerprint: "a".repeat(64),
    }),
  })).executions, 1);

  const stable = await cacheRun();
  const stableShard = stable.result.manifest.shards[0];
  const cacheEntryRoot = join(
    cacheFixtureRoot, ".git", "ledger-mutation-cache", "v1", stableShard.evidenceKey,
  );
  const entryPath = join(cacheEntryRoot, "entry.json");
  for (const [field, mutateEntry] of [
    ["classification", (entry) => ({ ...entry, classification: "verification-only" })],
    ["shardKind", (entry) => ({ ...entry, shardKind: "schema-static" })],
    ["toolVersions", (entry) => ({ ...entry, toolVersions: { ...entry.toolVersions, node: "22.0.1" } })],
    ["runtimeProfile", (entry) => ({ ...entry, runtimeProfile: { ...entry.runtimeProfile, locale: "es-EC" } })],
    ["dependencyHashes", (entry) => ({
      ...entry,
      dependencyHashes: { ...entry.dependencyHashes, "pnpm-lock.yaml": "b".repeat(64) },
    })],
    ["commandIdentity", (entry) => ({ ...entry, commandIdentity: "b".repeat(64) })],
    ["evidenceKey", (entry) => ({ ...entry, evidenceKey: "b".repeat(64) })],
    ["result", (entry) => ({ ...entry, result: "failed" })],
  ]) {
    const entry = JSON.parse(readFileSync(entryPath, "utf8"));
    writeFileSync(entryPath, `${JSON.stringify(mutateEntry(entry))}\n`, "utf8");
    const tampered = await cacheRun();
    assert.equal(tampered.executions, 1, `${field} metadata tampering must execute`);
    assert.equal(tampered.result.manifest.shards[0].cacheDecision, "rejected");
  }
  writeFileSync(join(cacheEntryRoot, "mutation-report.json"), "{corrupt", "utf8");
  const corrupt = await cacheRun();
  assert.equal(corrupt.executions, 1);
  assert.equal(corrupt.result.manifest.shards[0].cacheDecision, "rejected");

  const failedProfile = {
    node: "22.0.0", pnpm: "10.0.0", stryker: "9.0.1", typescript: "5.0.0", vitest: "3.0.0",
  };
  await assert.rejects(
    cacheRun({ toolVersions: failedProfile, executorStatus: 1 }),
    /mutation shard .* failed/,
  );
  assert.equal((await cacheRun({ toolVersions: failedProfile })).executions, 1);

  const unavailable = await cacheRun({ runtimeProfileProvider: () => { throw new Error("offline"); } });
  assert.equal(unavailable.executions, 1);
  assert.equal(unavailable.result.manifest.shards[0].cacheDecision, "rejected");
  assert.equal(unavailable.result.manifest.shards[0].reason, "runtime-profile-unavailable");
  assert.equal(JSON.stringify(unavailable.result.manifest).includes("databaseUrl"), false);
  assert.equal(JSON.stringify(unavailable.result.manifest).includes("localhost"), false);
  assert.equal((await cacheRun({ env: { MUTATION_CACHE: "off" } })).executions, 1);

  const performanceDirectory = join(cacheFixtureRoot, "reports/mutation-performance");
  const failureRecordsBefore = new Set(
    existsSync(performanceDirectory) ? readdirSync(performanceDirectory) : [],
  );
  await assert.rejects(
    cacheRun({ beforeEvidence: () => { throw new Error("profile exploded"); } }),
  );
  const failureRecords = readdirSync(performanceDirectory);
  const failedRecordName = failureRecords.find((name) => !failureRecordsBefore.has(name));
  assert.ok(failedRecordName);
  const failedRecord = JSON.parse(readFileSync(join(
    performanceDirectory, failedRecordName,
  ), "utf8"));
  assert.equal(failedRecord.outcome, "failed");
  assert.equal(failedRecord.shards.every((shard) => shard.status === "started" || shard.result !== "passed"), true);

  const signalProcess = new EventEmitter();
  signalProcess.exit = (code) => { throw Object.assign(new Error("signal exit"), { code }); };
  const signalRecordsBefore = new Set(readdirSync(performanceDirectory));
  await assert.rejects(cacheRun({
    signalProcess,
    beforeEvidence: () => {
      signalProcess.emit("SIGTERM");
    },
  }), /signal exit/);
  const signalRecords = readdirSync(performanceDirectory);
  const interruptedRecordName = signalRecords.find((name) => !signalRecordsBefore.has(name));
  assert.ok(interruptedRecordName);
  const interruptedRecord = JSON.parse(readFileSync(join(
    performanceDirectory, interruptedRecordName,
  ), "utf8"));
  assert.equal(interruptedRecord.outcome, "interrupted");
} finally {
  rmSync(cacheFixtureRoot, { force: true, recursive: true });
}

const pageFixtureRoot = mkdtempSync(join(tmpdir(), "smp-mutation-page-cache-"));
const pageWrite = (path, contents) => {
  const destination = join(pageFixtureRoot, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents, "utf8");
};
let pageBase;
let pageExecutions = 0;
const runPageFixture = () => runMutationScope({
  cwd: pageFixtureRoot,
  env: { MUTATION_BASE: pageBase },
  installSignalHandlers: false,
  toolVersions: {
    node: "22.0.0", pnpm: "10.0.0", stryker: "9.0.0", typescript: "5.0.0", vitest: "3.0.0",
  },
  runtimeProfileProvider: () => ({
    arch: "x64", locale: "en-US", platform: "linux", timezone: "UTC",
  }),
  executeShard: ({ shard }) => {
    pageExecutions += 1;
    const line = Number(/:(\d+)-/.exec(shard.mutate[0])?.[1]);
    pageWrite(shard.jsonReportPath, `${JSON.stringify({
      config: {
        configFile: shard.configPath,
        jsonReporter: { fileName: shard.jsonReportPath },
        mutate: shard.mutate,
      },
      files: Object.fromEntries(shard.sources.map((sourcePath) => [sourcePath, {
          source: readFileSync(join(pageFixtureRoot, sourcePath), "utf8"),
          mutants: [{ id: "0", location: { start: { line }, end: { line } }, status: "Killed" }],
        }])),
    })}\n`);
    return { status: 0 };
  },
});
try {
  execFileSync("git", ["init", "--quiet"], { cwd: pageFixtureRoot });
  execFileSync("git", ["config", "user.email", "page-cache@example.invalid"], { cwd: pageFixtureRoot });
  execFileSync("git", ["config", "user.name", "Page Cache Test"], { cwd: pageFixtureRoot });
  pageWrite("package.json", JSON.stringify({ name: "page-fixture", private: true }));
  pageWrite("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  pageWrite("stryker.conf.json", JSON.stringify({ testFiles: [] }));
  pageWrite("vitest.mutation.config.mjs", "export default {};\n");
  pageWrite("apps/web/package.json", JSON.stringify({ name: "web-fixture" }));
  pageWrite("apps/web/next.config.ts", "export default { output: 'standalone' };\n");
  pageWrite("apps/web/next.config.test.ts", "export {};\n");
  pageWrite("apps/web/vitest.config.ts", `${Array.from(
    { length: 20 }, (_, index) => `// config line ${index + 1}`,
  ).join("\n")}\nexport default { test: { passWithNoTests: true } };\n`);
  pageWrite(poolsPageSource, poolsPageChanges[0].oldContents);
  pageWrite("apps/web/src/app/(authenticated)/cupos/page.test.ts", "export {};\n");
  for (const path of [
    "scripts/mutation-scope.mjs",
    "scripts/mutation-evidence/fingerprint.mjs",
    "scripts/mutation-evidence/cache.mjs",
    "scripts/mutation-evidence/performance.mjs",
  ]) pageWrite(path, "export {};\n");
  execFileSync("git", ["add", "."], { cwd: pageFixtureRoot });
  execFileSync("git", ["commit", "--quiet", "-m", "page base"], { cwd: pageFixtureRoot });
  pageBase = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: pageFixtureRoot, encoding: "utf8",
  }).trim();
  pageWrite(poolsPageSource, poolsPageChanges[0].newContents);
  const pageCold = await runPageFixture();
  assert.equal(pageExecutions, 1);
  assert.deepEqual(pageCold.performance.shards.map(({ classification }) => classification), ["scored"]);
  const pageSourceBeforeConfigChange = readFileSync(join(pageFixtureRoot, poolsPageSource), "utf8");
  pageWrite("apps/web/next.config.ts", "export default { output: 'export' };\n");
  pageWrite("apps/web/vitest.config.ts", `${Array.from(
    { length: 20 }, (_, index) => `// config line ${index + 1}`,
  ).join("\n")}\nexport default { test: { passWithNoTests: false } };\n`);
  const pageConfigMiss = await runPageFixture();
  assert.equal(pageExecutions, 4);
  assert.equal(
    pageConfigMiss.performance.shards.find(({ id }) => id.startsWith("vitest-config-static-"))
      .classification,
    "scored",
  );
  const changedPageShard = pageConfigMiss.manifest.shards.find((shard) =>
    shard.sources.includes(poolsPageSource));
  assert.notEqual(
    changedPageShard.evidenceKey,
    pageCold.manifest.shards[0].evidenceKey,
  );
  assert.equal(readFileSync(join(pageFixtureRoot, poolsPageSource), "utf8"), pageSourceBeforeConfigChange);
} finally {
  rmSync(pageFixtureRoot, { force: true, recursive: true });
}

const projectionFixtureRoot = mkdtempSync(join(tmpdir(), "smp-mutation-projection-cache-"));
const projectionWrite = (path, contents) => {
  const destination = join(projectionFixtureRoot, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents, "utf8");
};
const projectionDigest = "a".repeat(64);
const projectionHash = (contents) => createHash("sha256").update(contents).digest("hex");
const projectionResultHash = (status) => projectionHash(JSON.stringify({
  error: null,
  outputHash: projectionDigest,
  signal: null,
  status,
}));
const projectionFaultSources = [
  poolProjectionNew.replace(
    "capacity.effective_from::text AS effective_from",
    "capacity.effective_from::text AS wrong_effective_from",
  ),
  poolProjectionNew.replace(
    "vac.license_type_id, vac.purchased_qty, vac.effective_from",
    "vac.license_type_id, vac.purchased_qty",
  ),
  poolProjectionNew.replace(
    "effectiveFrom: row.effective_from",
    "effectiveFrom: row.contract_renewal_on",
  ),
  poolProjectionNew.replace(
    "effectiveFrom: row.effective_from",
    "effectiveFrom: input.operatingDate",
  ),
  poolProjectionNew.replace(
    "effectiveFrom: row.effective_from",
    'effectiveFrom: "2026-08-04"',
  ),
];
const validProjectionEvidence = () => ({
  baseline: {
    expectedStatus: "passed", observedExitStatus: 0, observedSignal: null,
    observedStatus: "passed", outputHash: projectionDigest, resultHash: projectionResultHash(0),
  },
  controls: [
    "outer-projection-removed-or-renamed",
    "lateral-field-removed",
    "row-mapping-wrong",
    "operating-date-input-replaced",
    "operating-date-constant",
  ].map((faultId, index) => ({
    expectedStatus: "failed", faultId, observedExitStatus: 1, observedSignal: null,
    observedStatus: "failed", outputHash: projectionDigest,
    resultHash: projectionResultHash(1), variantSourceHash: projectionHash(projectionFaultSources[index]),
  })),
  source: poolProjectionSource,
  sourceHash: createHash("sha256").update(poolProjectionNew).digest("hex"),
  test: "packages/db/src/pool-snapshots.test.ts",
});
let projectionBase;
let projectionExecutions = 0;
const runProjectionFixture = () => runMutationScope({
  cwd: projectionFixtureRoot,
  env: { MUTATION_BASE: projectionBase },
  installSignalHandlers: false,
  toolVersions: {
    node: "22.0.0", pnpm: "10.0.0", stryker: "9.0.0", typescript: "5.0.0", vitest: "3.0.0",
  },
  runtimeProfileProvider: () => ({
    arch: "x64", locale: "en-US", platform: "linux", timezone: "UTC",
    databaseDriver: "postgres", databaseServerVersion: "16.4",
    schemaFingerprint: "a".repeat(64),
  }),
  executeShard: ({ shard }) => {
    projectionExecutions += 1;
    projectionWrite(shard.jsonReportPath, `${JSON.stringify({
      config: {
        configFile: shard.configPath,
        jsonReporter: { fileName: shard.jsonReportPath },
        mutate: shard.mutate,
      },
      files: {},
    })}\n`);
    return { status: 0 };
  },
  verificationRunner: (_command, args) => {
    const evidencePath = args.find((argument) => argument.endsWith("-projection.json"));
    projectionWrite(evidencePath, `${JSON.stringify(validProjectionEvidence())}\n`);
    return { status: 0 };
  },
});
try {
  execFileSync("git", ["init", "--quiet"], { cwd: projectionFixtureRoot });
  execFileSync("git", ["config", "user.email", "projection-cache@example.invalid"], { cwd: projectionFixtureRoot });
  execFileSync("git", ["config", "user.name", "Projection Cache Test"], { cwd: projectionFixtureRoot });
  projectionWrite("package.json", JSON.stringify({ name: "projection-fixture", private: true }));
  projectionWrite("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  projectionWrite("stryker.conf.json", JSON.stringify({ testFiles: [] }));
  projectionWrite("vitest.mutation.config.mjs", "export default {};\n");
  projectionWrite("packages/db/package.json", JSON.stringify({ name: "@smp/db" }));
  projectionWrite("packages/db/src/pool-snapshots.ts", poolProjectionOld);
  projectionWrite("packages/db/src/pool-snapshots.test.ts", "export {};\n");
  projectionWrite("scripts/verify-pool-snapshot-projection.mjs", 'import "node:fs";\nexport {};\n');
  projectionWrite("scripts/mutation-scope.mjs", "export {};\n");
  projectionWrite("scripts/mutation-evidence/fingerprint.mjs", "export {};\n");
  projectionWrite("scripts/mutation-evidence/cache.mjs", "export {};\n");
  projectionWrite("scripts/mutation-evidence/performance.mjs", "export {};\n");
  execFileSync("git", ["add", "."], { cwd: projectionFixtureRoot });
  execFileSync("git", ["commit", "--quiet", "-m", "projection base"], { cwd: projectionFixtureRoot });
  projectionBase = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: projectionFixtureRoot, encoding: "utf8",
  }).trim();
  projectionWrite("packages/db/src/pool-snapshots.ts", poolProjectionNew);
  const projectionCold = await runProjectionFixture();
  const projectionColdShard = projectionCold.manifest.shards[0];
  assert.equal(projectionColdShard.classification, "verification-only");
  assert.equal(projectionCold.performance.shards[0].classification, "verification-only");
  assert.equal(typeof projectionColdShard.result, "object");
  projectionWrite("docs/unrelated.md", "unrelated documentation\n");
  const projectionWarm = await runProjectionFixture();
  const projectionWarmShard = projectionWarm.manifest.shards[0];
  assert.equal(projectionExecutions, 1);
  assert.equal(projectionWarmShard.cacheDecision, "reused");
  assert.equal(projectionWarm.performance.shards[0].classification, "verification-only");
  assert.deepEqual(projectionWarmShard.result, projectionColdShard.result);

  const projectionEntryRoot = join(
    projectionFixtureRoot, ".git", "ledger-mutation-cache", "v1", projectionWarmShard.evidenceKey,
  );
  const projectionEntryPath = join(projectionEntryRoot, "entry.json");
  const tamperProjection = async (evidence) => {
    const artifactPath = join(projectionEntryRoot, "projection-evidence.json");
    writeFileSync(artifactPath, `${JSON.stringify(evidence)}\n`, "utf8");
    const entry = JSON.parse(readFileSync(projectionEntryPath, "utf8"));
    entry.artifacts["projection-evidence.json"] = createHash("sha256")
      .update(readFileSync(artifactPath)).digest("hex");
    writeFileSync(projectionEntryPath, `${JSON.stringify(entry)}\n`, "utf8");
    const executionsBefore = projectionExecutions;
    const rerun = await runProjectionFixture();
    assert.equal(projectionExecutions, executionsBefore + 1);
    assert.equal(rerun.manifest.shards[0].cacheDecision, "rejected");
  };
  await tamperProjection({});
  const alteredControl = validProjectionEvidence();
  alteredControl.controls[0].observedStatus = "passed";
  await tamperProjection(alteredControl);
  const alteredVariantSourceHash = validProjectionEvidence();
  alteredVariantSourceHash.controls[0].variantSourceHash = "b".repeat(64);
  await tamperProjection(alteredVariantSourceHash);
  const alteredResultHash = validProjectionEvidence();
  alteredResultHash.controls[0].resultHash = "b".repeat(64);
  await tamperProjection(alteredResultHash);
} finally {
  rmSync(projectionFixtureRoot, { force: true, recursive: true });
}
