import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  EVIDENCE_SCHEMA_VERSION,
  canonicalJson,
  collectExecutionInputs,
  createEvidenceKey,
  sha256,
} from "./mutation-evidence/fingerprint.mjs";

assert.equal(EVIDENCE_SCHEMA_VERSION, 1);
assert.equal(
  canonicalJson({ z: 1, a: { y: 2, b: 3 }, list: [{ z: true, a: null }] }),
  '{"a":{"b":3,"y":2},"list":[{"a":null,"z":true}],"z":1}',
);

for (const invalid of [
  undefined,
  () => {},
  Symbol("invalid"),
  Number.NaN,
  Number.POSITIVE_INFINITY,
  { nested: undefined },
  [1, () => {}],
  Array(1),
]) {
  assert.throws(() => canonicalJson(invalid), TypeError);
}
const cyclic = {};
cyclic.self = cyclic;
assert.throws(() => canonicalJson(cyclic), /cyclic/i);

assert.equal(
  sha256("ledger"),
  "fe14010b4fe83303852f0467c919ef9a7ca089b91e96e3aad7d426dd87079297",
);

const base = {
  shardKind: "stryker",
  executionInputs: {
    "apps/web/src/rule.ts": "source-a",
    "apps/web/src/rule.test.ts": "test-a",
    "stryker.conf.json": "config-a",
    "pnpm-lock.yaml": "lock-a",
  },
  toolVersions: { node: "22.12.0", typescript: "5.9.3" },
  runtimeProfile: { platform: "linux", arch: "x64", timezone: "UTC" },
  dependencyResolverVersion: 1,
  head: "head-a",
  base: "base-a",
  baseRef: "main",
  reportPath: "/tmp/one/report.html",
  jsonReportPath: "/tmp/one/report.json",
};

const provenanceOnly = {
  ...base,
  head: "head-b",
  base: "base-b",
  baseRef: "release",
  reportPath: "/tmp/two/report.html",
  jsonReportPath: "/tmp/two/report.json",
};
assert.equal(createEvidenceKey(base), createEvidenceKey(provenanceOnly));
assert.match(createEvidenceKey(base), /^[a-f0-9]{64}$/);

const mutations = [
  { ...base, executionInputs: { ...base.executionInputs, "apps/web/src/rule.ts": "source-b" } },
  { ...base, executionInputs: { ...base.executionInputs, "apps/web/src/rule.test.ts": "test-b" } },
  { ...base, executionInputs: { ...base.executionInputs, "stryker.conf.json": "config-b" } },
  { ...base, executionInputs: { ...base.executionInputs, "pnpm-lock.yaml": "lock-b" } },
  { ...base, toolVersions: { ...base.toolVersions, typescript: "5.9.4" } },
  { ...base, runtimeProfile: { ...base.runtimeProfile, arch: "arm64" } },
  { ...base, dependencyResolverVersion: 2 },
];
for (const mutation of mutations) {
  assert.notEqual(createEvidenceKey(base), createEvidenceKey(mutation));
}

async function put(root, relativePath, contents) {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

async function expectedInputs(root, relativePaths, toolVersions, runtimeProfile) {
  const entries = await Promise.all(
    relativePaths.map(async (relativePath) => [
      relativePath,
      sha256(await readFile(path.join(root, relativePath))),
    ]),
  );
  entries.push(
    ["@mutation-evidence/dependency-resolver.json", sha256(canonicalJson({ version: 1 }))],
    [
      "@mutation-evidence/fingerprint.mjs",
      sha256(await readFile(new URL("./mutation-evidence/fingerprint.mjs", import.meta.url))),
    ],
    ["@runtime/profile.json", sha256(canonicalJson(runtimeProfile))],
    ["@tool/versions.json", sha256(canonicalJson(toolVersions))],
  );
  return Object.fromEntries(
    entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

const fixtureRoot = await mkdtemp(path.join(tmpdir(), "ledger-fingerprint-"));
try {
  const files = {
    "package.json": '{"name":"fixture-root","private":true}',
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n',
    "stryker.config.mjs": 'import "./scripts/runner.mjs";\nexport default {};\n',
    "scripts/runner.mjs": 'export const runner = "real";\n',
    "packages/app/package.json": '{"name":"@fixture/app","type":"module"}',
    "packages/app/src/main.ts":
      'import { helper } from "./helper.js";\nimport { rule } from "@fixture/rules";\nexport const result = helper + rule;\n',
    "packages/app/src/helper.ts": "export const helper = 1;\n",
    "packages/app/src/unrelated.ts": "export const unrelated = true;\n",
    "packages/rules/package.json":
      '{"name":"@fixture/rules","type":"module","exports":{".":"./src/index.ts"}}',
    "packages/rules/src/index.ts": "export const rule = 2;\n",
    "packages/db/migrations/0001_init.sql": "create table fixture (id integer);\n",
  };
  await Promise.all(
    Object.entries(files).map(([relativePath, contents]) => put(fixtureRoot, relativePath, contents)),
  );

  const toolVersions = { node: "22.12.0", typescript: "5.9.3" };
  const runtimeProfile = { arch: "x64", locale: "C", platform: "linux", timezone: "UTC" };
  process.env.LEDGER_FINGERPRINT_SECRET_SENTINEL = "must-not-be-persisted";
  const collected = collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/app/src/main.ts"],
    configurationFiles: ["stryker.config.mjs"],
    migrationRoots: ["packages/db/migrations"],
    toolVersions,
    runtimeProfile,
  });
  const expected = await expectedInputs(
    fixtureRoot,
    [
      "package.json",
      "packages/app/package.json",
      "packages/app/src/helper.ts",
      "packages/app/src/main.ts",
      "packages/db/migrations/0001_init.sql",
      "packages/rules/package.json",
      "packages/rules/src/index.ts",
      "pnpm-lock.yaml",
      "scripts/runner.mjs",
      "stryker.config.mjs",
    ],
    toolVersions,
    runtimeProfile,
  );
  assert.deepEqual(collected, expected);
  assert.equal(canonicalJson(collected).includes("must-not-be-persisted"), false);

  const uncertaintyFiles = {
    "packages/uncertain/package.json": '{"name":"@fixture/uncertain","type":"module"}',
    "packages/uncertain/src/dynamic.ts":
      'const target = "target";\nexport const loaded = import(`./${target}.js`);\n',
    "packages/uncertain/src/fs-read.ts":
      'import { readFileSync } from "node:fs";\nconst target = process.argv[2];\nexport const data = readFileSync(target, "utf8");\n',
    "packages/uncertain/src/unresolved.ts": 'import "./missing.js";\nexport const value = 1;\n',
    "packages/uncertain/src/unrelated.ts": "export const conservative = true;\n",
    "packages/uncertain/test/owned.test.ts": "export const testInput = true;\n",
    "packages/uncertain/vitest.config.ts": "export default {};\n",
  };
  await Promise.all(
    Object.entries(uncertaintyFiles).map(([relativePath, contents]) =>
      put(fixtureRoot, relativePath, contents),
    ),
  );
  const fallbackPaths = [
    "package.json",
    "packages/uncertain/package.json",
    "packages/uncertain/src/dynamic.ts",
    "packages/uncertain/src/fs-read.ts",
    "packages/uncertain/src/unrelated.ts",
    "packages/uncertain/src/unresolved.ts",
    "packages/uncertain/test/owned.test.ts",
    "packages/uncertain/vitest.config.ts",
    "pnpm-lock.yaml",
  ];
  for (const entryFile of [
    "packages/uncertain/src/dynamic.ts",
    "packages/uncertain/src/fs-read.ts",
    "packages/uncertain/src/unresolved.ts",
  ]) {
    assert.deepEqual(
      collectExecutionInputs({
        root: fixtureRoot,
        entryFiles: [entryFile],
        configurationFiles: [],
        migrationRoots: [],
        toolVersions,
        runtimeProfile,
      }),
      await expectedInputs(fixtureRoot, fallbackPaths, toolVersions, runtimeProfile),
    );
  }
} finally {
  delete process.env.LEDGER_FINGERPRINT_SECRET_SENTINEL;
  await rm(fixtureRoot, { recursive: true, force: true });
}
