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
  assert.deepEqual(collected, { hashes: expected, reasons: [], reusable: true });
  assert.equal(canonicalJson(collected).includes("must-not-be-persisted"), false);
  process.env.LEDGER_FINGERPRINT_SECRET_SENTINEL = "changed-secret-value";
  assert.deepEqual(
    collectExecutionInputs({
      root: fixtureRoot,
      entryFiles: ["packages/app/src/main.ts"],
      configurationFiles: ["stryker.config.mjs"],
      migrationRoots: ["packages/db/migrations"],
      toolVersions,
      runtimeProfile,
    }),
    collected,
  );

  const aliasFiles = {
    "apps/web/package.json": '{"name":"fixture-web","type":"module"}',
    "tsconfig.foundation.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        moduleResolution: "bundler",
        paths: { "@/*": ["./apps/web/src/*"] },
      },
    }),
    "tsconfig.base.json": JSON.stringify({
      extends: "./tsconfig.foundation.json",
      compilerOptions: { strict: true },
    }),
    "apps/web/tsconfig.json": JSON.stringify({
      extends: "../../tsconfig.base.json",
      compilerOptions: { module: "esnext" },
    }),
    "apps/web/src/app/page.ts":
      'import { aliased } from "@/lib/aliased";\nexport const page = aliased;\n',
    "apps/web/src/lib/aliased.ts":
      'import { nested } from "./nested.js";\nexport const aliased = nested;\n',
    "apps/web/src/lib/nested.ts": "export const nested = 42;\n",
  };
  await Promise.all(
    Object.entries(aliasFiles).map(([relativePath, contents]) =>
      put(fixtureRoot, relativePath, contents),
    ),
  );
  assert.deepEqual(
    collectExecutionInputs({
      root: fixtureRoot,
      entryFiles: ["apps/web/src/app/page.ts"],
      configurationFiles: [],
      migrationRoots: [],
      toolVersions,
      runtimeProfile,
    }),
    {
      hashes: await expectedInputs(
        fixtureRoot,
        [
          "apps/web/package.json",
          "apps/web/src/app/page.ts",
          "apps/web/src/lib/aliased.ts",
          "apps/web/src/lib/nested.ts",
          "apps/web/tsconfig.json",
          "package.json",
          "pnpm-lock.yaml",
          "tsconfig.base.json",
          "tsconfig.foundation.json",
        ],
        toolVersions,
        runtimeProfile,
      ),
      reasons: [],
      reusable: true,
    },
  );
  const aliasInputsBeforeGrandparentChange = collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["apps/web/src/app/page.ts"],
    configurationFiles: [],
    migrationRoots: [],
    toolVersions,
    runtimeProfile,
  });
  await put(
    fixtureRoot,
    "tsconfig.foundation.json",
    JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        moduleResolution: "bundler",
        paths: { "@/*": ["./apps/web/src/*"] },
        useDefineForClassFields: true,
      },
    }),
  );
  assert.notDeepEqual(
    collectExecutionInputs({
      root: fixtureRoot,
      entryFiles: ["apps/web/src/app/page.ts"],
      configurationFiles: [],
      migrationRoots: [],
      toolVersions,
      runtimeProfile,
    }),
    aliasInputsBeforeGrandparentChange,
  );

  const uncertaintyFiles = {
    "packages/uncertain/package.json": '{"name":"@fixture/uncertain","type":"module"}',
    "packages/uncertain/src/dynamic.ts":
      'const target = "target";\nexport const loaded = import(`./${target}.js`);\n',
    "packages/uncertain/src/fs-read.ts":
      'import { readFileSync } from "node:fs";\nconst target = process.argv[2];\nexport const data = readFileSync(target, "utf8");\n',
    "packages/uncertain/src/fs-aliased.ts":
      'import { readFile as loadOwned } from "node:fs/promises";\nconst target = process.argv[2];\nexport const data = loadOwned(target, "utf8");\n',
    "packages/uncertain/src/fs-stream.ts":
      'import * as storage from "node:fs";\nconst target = process.argv[2];\nexport const stream = storage.createReadStream(target);\n',
    "packages/uncertain/src/fs-open.ts":
      'import { open as acquire } from "node:fs/promises";\nconst target = process.argv[2];\nexport const handle = acquire(target, "r");\n',
    "packages/uncertain/src/fs-promises-property.ts":
      'import * as fs from "node:fs";\nconst target = process.argv[2];\nexport const data = fs.promises.readFile(target);\n',
    "packages/uncertain/src/fs-detached.ts":
      'import * as fs from "node:fs";\nconst read = fs.readFile;\nexport const data = read(process.argv[2], () => {});\n',
    "packages/uncertain/src/fs-commonjs-promises.cjs":
      'const { promises: fs } = require("fs");\nmodule.exports = fs.readFile(process.argv[2]);\n',
    "packages/uncertain/src/schema.sql": "select 1;\n",
    "packages/uncertain/config/settings.yaml": "mode: test\n",
    "packages/uncertain/fixtures/sample.csv": "id,name\n1,fixture\n",
    "packages/uncertain/public/example.svg": "<svg></svg>\n",
    "packages/uncertain/runtime-policy.txt": "runtime input\n",
    "packages/uncertain/templates/notice.hbs": "Hello {{name}}\n",
    "packages/uncertain/src/unresolved.ts": 'import "./missing.js";\nexport const value = 1;\n',
    "packages/uncertain/src/unrelated.ts": "export const conservative = true;\n",
    "packages/uncertain/test/owned.test.ts": "export const testInput = true;\n",
    "packages/uncertain/vitest.config.ts": "export default {};\n",
    "packages/uncertain/.env": "PASSWORD=must-not-be-persisted\n",
    "packages/uncertain/src/private.secret": "must-not-be-persisted\n",
    "packages/uncertain/generated/ignored.ts": "export const generated = true;\n",
    "packages/uncertain/dist/ignored.sql": "select 'generated';\n",
    "packages/uncertain/tsconfig.tsbuildinfo": "generated compiler state\n",
  };
  await Promise.all(
    Object.entries(uncertaintyFiles).map(([relativePath, contents]) =>
      put(fixtureRoot, relativePath, contents),
    ),
  );
  const fallbackPaths = [
    "package.json",
    "packages/uncertain/config/settings.yaml",
    "packages/uncertain/fixtures/sample.csv",
    "packages/uncertain/package.json",
    "packages/uncertain/src/dynamic.ts",
    "packages/uncertain/src/fs-aliased.ts",
    "packages/uncertain/src/fs-commonjs-promises.cjs",
    "packages/uncertain/src/fs-detached.ts",
    "packages/uncertain/src/fs-open.ts",
    "packages/uncertain/src/fs-promises-property.ts",
    "packages/uncertain/src/fs-read.ts",
    "packages/uncertain/src/fs-stream.ts",
    "packages/uncertain/src/schema.sql",
    "packages/uncertain/src/unrelated.ts",
    "packages/uncertain/src/unresolved.ts",
    "packages/uncertain/public/example.svg",
    "packages/uncertain/runtime-policy.txt",
    "packages/uncertain/templates/notice.hbs",
    "packages/uncertain/test/owned.test.ts",
    "packages/uncertain/vitest.config.ts",
    "pnpm-lock.yaml",
  ];
  for (const entryFile of [
    "packages/uncertain/src/dynamic.ts",
    "packages/uncertain/src/fs-aliased.ts",
    "packages/uncertain/src/fs-commonjs-promises.cjs",
    "packages/uncertain/src/fs-detached.ts",
    "packages/uncertain/src/fs-open.ts",
    "packages/uncertain/src/fs-promises-property.ts",
    "packages/uncertain/src/fs-read.ts",
    "packages/uncertain/src/fs-stream.ts",
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
      {
        hashes: await expectedInputs(fixtureRoot, fallbackPaths, toolVersions, runtimeProfile),
        reasons: [{ code: "excluded-runtime-inputs", workspace: "packages/uncertain" }],
        reusable: false,
      },
    );
  }
  const unsafeResult = collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/uncertain/src/fs-promises-property.ts"],
    configurationFiles: [],
    migrationRoots: [],
    toolVersions,
    runtimeProfile,
  });
  assert.equal(canonicalJson(unsafeResult).includes("must-not-be-persisted"), false);

  const safeRuntimeFiles = {
    "packages/safe/package.json": '{"name":"@fixture/safe","type":"module"}',
    "packages/safe/src/load.ts":
      'import { readFile } from "node:fs/promises";\nexport const load = readFile;\n',
    "packages/safe/fixtures/runtime.txt": "safe runtime input\n",
    "packages/safe/.cache/state.json": '{"generated":true}',
    "packages/safe/.next/server/chunk.js": "export const generated = true;\n",
    "packages/safe/.stryker-tmp/mutant.js": "export const mutant = true;\n",
    "packages/safe/.turbo/cache.json": '{"cache":true}',
    "packages/safe/build/output.js": "export const built = true;\n",
    "packages/safe/coverage/report.json": '{"coverage":100}',
    "packages/safe/dist/runtime.js": "export const generatedRuntime = true;\n",
    "packages/safe/reports/result.json": '{"result":"ok"}',
  };
  await Promise.all(
    Object.entries(safeRuntimeFiles).map(([relativePath, contents]) =>
      put(fixtureRoot, relativePath, contents),
    ),
  );
  assert.deepEqual(
    collectExecutionInputs({
      root: fixtureRoot,
      entryFiles: ["packages/safe/src/load.ts"],
      configurationFiles: [],
      migrationRoots: [],
      toolVersions,
      runtimeProfile,
    }),
    {
      hashes: await expectedInputs(
        fixtureRoot,
        [
          "package.json",
          "packages/safe/fixtures/runtime.txt",
          "packages/safe/package.json",
          "packages/safe/src/load.ts",
          "pnpm-lock.yaml",
        ],
        toolVersions,
        runtimeProfile,
      ),
      reasons: [],
      reusable: true,
    },
  );
  await put(
    fixtureRoot,
    "packages/explicit/package.json",
    '{"name":"@fixture/explicit","type":"module"}',
  );
  await put(
    fixtureRoot,
    "packages/explicit/src/uses-output.ts",
    'import { generatedRuntime } from "../dist/runtime.js";\nexport const value = generatedRuntime;\n',
  );
  await put(
    fixtureRoot,
    "packages/explicit/dist/runtime.js",
    "export const generatedRuntime = true;\n",
  );
  const explicitOutputResult = collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/explicit/src/uses-output.ts"],
    configurationFiles: [],
    migrationRoots: [],
    toolVersions,
    runtimeProfile,
  });
  assert.equal(explicitOutputResult.reusable, false);
  assert.deepEqual(explicitOutputResult.reasons, [
    { code: "excluded-runtime-inputs", workspace: "packages/explicit" },
  ]);
} finally {
  delete process.env.LEDGER_FINGERPRINT_SECRET_SENTINEL;
  await rm(fixtureRoot, { recursive: true, force: true });
}

const repositoryProbe = collectExecutionInputs({
  root: path.resolve(new URL("..", import.meta.url).pathname),
  entryFiles: ["scripts/mutation-scope.mjs"],
  configurationFiles: [],
  migrationRoots: [],
  toolVersions: { node: process.versions.node },
  runtimeProfile: { arch: process.arch, platform: process.platform },
});
assert.equal(repositoryProbe.reusable, true);
assert.deepEqual(repositoryProbe.reasons, []);
assert.ok(repositoryProbe.hashes["scripts/mutation-scope.mjs"]);
