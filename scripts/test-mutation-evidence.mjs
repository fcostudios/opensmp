import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  CACHE_SCHEMA_VERSION,
  cacheRoot,
  clearMutationCache,
  readCacheEntry,
  writeSuccessfulCacheEntry,
} from "./mutation-evidence/cache.mjs";
import {
  EVIDENCE_SCHEMA_VERSION,
  canonicalJson,
  collectExecutionInputs,
  createEvidenceKey,
  sha256,
} from "./mutation-evidence/fingerprint.mjs";
import {
  createPerformanceRun,
  finishPerformanceRun,
  finishShard,
  renderBenchmarkSummary,
  startShard,
  writePerformanceRecord,
} from "./mutation-evidence/performance.mjs";

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
const symlinkTargetRoot = await mkdtemp(path.join(tmpdir(), "ledger-fingerprint-symlink-target-"));
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
    "apps/next-shim/package.json",
    '{"name":"fixture-next-shim","type":"module"}',
  );
  await put(
    fixtureRoot,
    "apps/next-shim/next-env.d.ts",
    '/// <reference types="next" />\nimport "./.next/types/routes.d.ts";\n',
  );
  await put(
    fixtureRoot,
    "apps/next-shim/.next/types/routes.d.ts",
    "export type GeneratedRoute = string;\n",
  );
  const nextGeneratedShim = collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["apps/next-shim/next-env.d.ts"],
    configurationFiles: [],
    migrationRoots: [],
    toolVersions,
    runtimeProfile,
  });
  assert.equal(nextGeneratedShim.reusable, true);
  assert.deepEqual(nextGeneratedShim.reasons, []);
  assert.equal(
    Object.keys(nextGeneratedShim.hashes).some((file) => file.includes("/.next/")),
    false,
  );
  await put(
    fixtureRoot,
    "apps/next-shim/owned.ts",
    "export const owned = 1;\n",
  );
  await put(
    fixtureRoot,
    "apps/next-shim/next-env.d.ts",
    '/// <reference types="next" />\nimport "./.next/../owned.ts";\n',
  );
  const traversingNextShimBefore = collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["apps/next-shim/next-env.d.ts"],
    configurationFiles: [],
    migrationRoots: [],
    toolVersions,
    runtimeProfile,
  });
  assert.ok(traversingNextShimBefore.hashes["apps/next-shim/owned.ts"]);
  await put(
    fixtureRoot,
    "apps/next-shim/owned.ts",
    "export const owned = 2;\n",
  );
  const traversingNextShimAfter = collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["apps/next-shim/next-env.d.ts"],
    configurationFiles: [],
    migrationRoots: [],
    toolVersions,
    runtimeProfile,
  });
  assert.notEqual(
    traversingNextShimBefore.hashes["apps/next-shim/owned.ts"],
    traversingNextShimAfter.hashes["apps/next-shim/owned.ts"],
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

  const externalSentinel = "external-secret-must-not-be-persisted";
  const externalFile = path.join(path.dirname(fixtureRoot), `${path.basename(fixtureRoot)}-external.ts`);
  await writeFile(externalFile, `export const external = "${externalSentinel}";\n`);
  await put(
    fixtureRoot,
    "packages/external/package.json",
    '{"name":"@fixture/external","type":"module"}',
  );
  const externalEntry = "packages/external/src/main.ts";
  const externalSpecifiers = [
    externalFile,
    path.relative(path.join(fixtureRoot, path.dirname(externalEntry)), externalFile),
  ];
  for (const externalSpecifier of externalSpecifiers) {
    await put(
      fixtureRoot,
      externalEntry,
      `import { external } from ${JSON.stringify(externalSpecifier)};\nexport const value = external;\n`,
    );
    const externalResult = collectExecutionInputs({
      root: fixtureRoot,
      entryFiles: [externalEntry],
      configurationFiles: [],
      migrationRoots: [],
      toolVersions,
      runtimeProfile,
    });
    assert.equal(externalResult.reusable, false);
    assert.deepEqual(externalResult.reasons, [
      { code: "external-local-dependency", workspace: "packages/external" },
    ]);
    assert.equal(canonicalJson(externalResult).includes(externalSentinel), false);
  }
  await rm(externalFile, { force: true });

  await put(
    fixtureRoot,
    "packages/nonliteral/package.json",
    '{"name":"@fixture/nonliteral","type":"commonjs"}',
  );
  await put(
    fixtureRoot,
    "packages/nonliteral/src/unrelated.ts",
    "export const closure = 1;\n",
  );
  for (const source of [
    'const target = process.argv[2];\nmodule.exports = require(target);\n',
    'const target = process.argv[2];\nmodule.exports = require(target + ".cjs");\n',
    'module.exports = require("./local.cjs", "unexpected");\n',
  ]) {
    await put(fixtureRoot, "packages/nonliteral/src/main.cjs", source);
    const nonliteralBefore = collectExecutionInputs({
      root: fixtureRoot,
      entryFiles: ["packages/nonliteral/src/main.cjs"],
      configurationFiles: [],
      migrationRoots: [],
      toolVersions,
      runtimeProfile,
    });
    assert.equal(nonliteralBefore.reusable, true);
    assert.ok(nonliteralBefore.hashes["packages/nonliteral/src/unrelated.ts"]);
    await put(
      fixtureRoot,
      "packages/nonliteral/src/unrelated.ts",
      `export const closure = ${source.length};\n`,
    );
    const nonliteralAfter = collectExecutionInputs({
      root: fixtureRoot,
      entryFiles: ["packages/nonliteral/src/main.cjs"],
      configurationFiles: [],
      migrationRoots: [],
      toolVersions,
      runtimeProfile,
    });
    assert.notEqual(
      nonliteralBefore.hashes["packages/nonliteral/src/unrelated.ts"],
      nonliteralAfter.hashes["packages/nonliteral/src/unrelated.ts"],
    );
  }

  const symlinkPath = path.join(fixtureRoot, "packages/nonliteral/src/runtime-link.ts");
  const symlinkTargets = [
    path.join(symlinkTargetRoot, "first-sensitive-target.ts"),
    path.join(symlinkTargetRoot, "second-sensitive-target.ts"),
  ];
  await writeFile(symlinkTargets[0], 'export const secret = "first-symlink-sentinel";\n');
  await writeFile(symlinkTargets[1], 'export const secret = "second-symlink-sentinel";\n');
  const symlinkResults = [];
  for (const symlinkTarget of symlinkTargets) {
    await rm(symlinkPath, { force: true });
    await symlink(symlinkTarget, symlinkPath);
    await put(
      fixtureRoot,
      "packages/nonliteral/src/main.cjs",
      'const target = process.argv[2];\nmodule.exports = require(target);\n',
    );
    const fallbackResult = collectExecutionInputs({
      root: fixtureRoot,
      entryFiles: ["packages/nonliteral/src/main.cjs"],
      configurationFiles: [],
      migrationRoots: [],
      toolVersions,
      runtimeProfile,
    });
    await put(
      fixtureRoot,
      "packages/nonliteral/src/main.cjs",
      'module.exports = require("./runtime-link.ts");\n',
    );
    const explicitResult = collectExecutionInputs({
      root: fixtureRoot,
      entryFiles: ["packages/nonliteral/src/main.cjs"],
      configurationFiles: [],
      migrationRoots: [],
      toolVersions,
      runtimeProfile,
    });
    symlinkResults.push(...[fallbackResult, explicitResult].map((result) => ({
      hasSymlinkHash: Boolean(result.hashes["packages/nonliteral/src/runtime-link.ts"]),
      leaksSentinel: canonicalJson(result).includes("symlink-sentinel"),
      leaksTarget: canonicalJson(result).includes(symlinkTarget),
      reasons: result.reasons,
      reusable: result.reusable,
    })));
  }
  assert.deepEqual(symlinkResults, Array.from({ length: 4 }, () => ({
    hasSymlinkHash: false,
    leaksSentinel: false,
    leaksTarget: false,
    reasons: [{ code: "symlink-runtime-input", workspace: "packages/nonliteral" }],
    reusable: false,
  })));

  await put(
    fixtureRoot,
    "packages/symlink-node-modules/package.json",
    '{"name":"@fixture/symlink-node-modules","type":"commonjs"}',
  );
  await put(
    fixtureRoot,
    "packages/symlink-node-modules/src/main.cjs",
    'const target = process.argv[2];\nmodule.exports = require(target);\n',
  );
  await mkdir(path.join(fixtureRoot, "packages/symlink-node-modules/node_modules"), {
    recursive: true,
  });
  await symlink(
    symlinkTargetRoot,
    path.join(fixtureRoot, "packages/symlink-node-modules/node_modules/fixture-third-party"),
  );
  const symlinkNodeModulesResult = collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/symlink-node-modules/src/main.cjs"],
    configurationFiles: [],
    migrationRoots: [],
    toolVersions,
    runtimeProfile,
  });
  assert.equal(symlinkNodeModulesResult.reusable, true);
  assert.deepEqual(symlinkNodeModulesResult.reasons, []);

  await put(
    fixtureRoot,
    "node_modules/fixture-third-party/package.json",
    '{"name":"fixture-third-party","types":"index.d.ts"}',
  );
  await put(
    fixtureRoot,
    "node_modules/fixture-third-party/index.d.ts",
    "export declare const thirdParty: boolean;\n",
  );
  await put(
    fixtureRoot,
    "packages/vendor-user/package.json",
    '{"name":"@fixture/vendor-user","type":"module"}',
  );
  await put(
    fixtureRoot,
    "packages/vendor-user/src/main.ts",
    'import { thirdParty } from "fixture-third-party";\nexport const value = thirdParty;\n',
  );
  const thirdPartyResult = collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/vendor-user/src/main.ts"],
    configurationFiles: [],
    migrationRoots: [],
    toolVersions,
    runtimeProfile,
  });
  assert.equal(thirdPartyResult.reusable, true);
  assert.equal(Object.keys(thirdPartyResult.hashes).some((file) => file.includes("node_modules")), false);
} finally {
  delete process.env.LEDGER_FINGERPRINT_SECRET_SENTINEL;
  await rm(fixtureRoot, { recursive: true, force: true });
  await rm(symlinkTargetRoot, { recursive: true, force: true });
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

function runFixtureGit(repoRoot) {
  return (args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

const cacheFixture = await mkdtemp(path.join(tmpdir(), "ledger-mutation-cache-"));
let cacheContractCompleted = false;
try {
  const repository = path.join(cacheFixture, "repository");
  const linkedWorktree = path.join(cacheFixture, "linked-worktree");
  await mkdir(repository);
  execFileSync("git", ["init", "-q"], { cwd: repository });
  execFileSync("git", ["config", "user.email", "cache-test@example.invalid"], { cwd: repository });
  execFileSync("git", ["config", "user.name", "Cache Contract Test"], { cwd: repository });
  await writeFile(path.join(repository, "tracked.txt"), "fixture\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: repository });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: repository });
  execFileSync("git", ["worktree", "add", "-q", "-b", "cache-linked", linkedWorktree], {
    cwd: repository,
  });

  const repositoryCacheRoot = cacheRoot(repository, runFixtureGit(repository));
  const linkedCacheRoot = cacheRoot(linkedWorktree, runFixtureGit(linkedWorktree));
  const commonDirectory = await realpath(path.resolve(
    repository,
    runFixtureGit(repository)(["rev-parse", "--git-common-dir"]),
  ));
  assert.equal(repositoryCacheRoot, path.join(commonDirectory, "ledger-mutation-cache", "v1"));
  assert.equal(linkedCacheRoot, repositoryCacheRoot);
  assert.equal(CACHE_SCHEMA_VERSION, 1);

  const evidenceKey = sha256("successful-cache-entry");
  const reportSource = path.join(cacheFixture, "mutation-report.json");
  const htmlSource = path.join(cacheFixture, "mutation-report.html");
  await writeFile(reportSource, JSON.stringify({ files: {}, schemaVersion: "1" }));
  await writeFile(htmlSource, "<html>passed</html>\n");
  const secretSentinel = "postgres://cache-secret:do-not-write@example.invalid/ledger";
  writeSuccessfulCacheEntry({
    root: repositoryCacheRoot,
    evidenceKey,
    entry: {
      result: "passed",
      shardKind: "stryker",
      durationMs: 125,
    },
    artifacts: {
      "mutation-report.json": reportSource,
      "mutation-report.html": htmlSource,
    },
  });

  let validatorCalls = 0;
  const hit = readCacheEntry({
    root: linkedCacheRoot,
    evidenceKey,
    validateArtifacts(artifacts, entry) {
      validatorCalls += 1;
      assert.equal(entry.result, "passed");
      assert.deepEqual(Object.keys(artifacts).sort(), [
        "mutation-report.html",
        "mutation-report.json",
      ]);
      assert.deepEqual(JSON.parse(execFileSync("node", ["-e", `process.stdout.write(require('fs').readFileSync(${JSON.stringify(artifacts["mutation-report.json"])}, 'utf8'))`], { encoding: "utf8" })), {
        files: {},
        schemaVersion: "1",
      });
      return true;
    },
  });
  assert.equal(hit.hit, true);
  assert.equal(hit.entry.evidenceKey, evidenceKey);
  assert.equal(hit.entry.result, "passed");
  assert.equal(validatorCalls, 1);
  const persistedEntry = await readFile(path.join(repositoryCacheRoot, evidenceKey, "entry.json"), "utf8");
  assert.equal(persistedEntry.includes(secretSentinel), false);
  assert.equal(persistedEntry.includes("DATABASE_URL"), false);
  assert.equal(
    (await readdir(repositoryCacheRoot)).some((name) => name.endsWith(".temporary")),
    false,
  );

  const unsafeEntries = [
    { runtimeProfile: { platform: "linux", DATABASE_URL: secretSentinel } },
    { runtimeProfile: { platform: "linux", nested: { token: secretSentinel } } },
    { toolVersions: { node: "22.12.0", password: secretSentinel } },
    { commandList: [["node", ["runner.mjs", "--token", secretSentinel]]] },
    { commandList: [{ command: "node", metadata: { authorization: secretSentinel } }] },
    { runtimeProfile: { platform: "linux", credential: "https://user:pass@example.invalid" } },
    { runtimeProfile: { platform: "opaque-secret-sentinel" } },
    { toolVersions: { node: "opaque-secret-sentinel" } },
    { environment: { region: "local" } },
    { extraMetadata: { region: "local" } },
    JSON.parse('{"toolVersions":{"__proto__":"22.12.0"}}'),
  ];
  for (const [index, unsafeMetadata] of unsafeEntries.entries()) {
    const unsafeKey = sha256(`unsafe-cache-entry-${index}`);
    assert.throws(
      () => writeSuccessfulCacheEntry({
        root: repositoryCacheRoot,
        evidenceKey: unsafeKey,
        entry: { result: "passed", ...unsafeMetadata },
        artifacts: { "mutation-report.json": reportSource },
      }),
      (error) => error.message === "Unsafe cache metadata",
    );
    assert.equal(
      (await readdir(repositoryCacheRoot)).includes(unsafeKey),
      false,
    );
  }
  assert.equal(
    (await Promise.all(
      (await readdir(repositoryCacheRoot)).map(async (name) =>
        readFile(path.join(repositoryCacheRoot, name, "entry.json"), "utf8").catch(() => ""),
      ),
    )).join("\n").includes(secretSentinel),
    false,
  );
  await writeFile(path.join(repositoryCacheRoot, evidenceKey, "mutation-report.json"), "truncated");
  assert.deepEqual(
    readCacheEntry({
      root: repositoryCacheRoot,
      evidenceKey,
      validateArtifacts: () => true,
    }),
    { hit: false, reason: "artifact-hash-mismatch" },
  );
  writeSuccessfulCacheEntry({
    root: repositoryCacheRoot,
    evidenceKey,
    entry: { result: "passed", shardKind: "stryker", durationMs: 125 },
    artifacts: {
      "mutation-report.json": reportSource,
      "mutation-report.html": htmlSource,
    },
  });
  assert.equal(
    readCacheEntry({
      root: repositoryCacheRoot,
      evidenceKey,
      validateArtifacts: () => true,
    }).hit,
    true,
  );

  assert.throws(
    () => readCacheEntry({ root: repositoryCacheRoot, evidenceKey }),
    /validateArtifacts/i,
  );
  assert.deepEqual(
    readCacheEntry({
      root: repositoryCacheRoot,
      evidenceKey: sha256("missing"),
      validateArtifacts: () => true,
    }),
    { hit: false, reason: "not-found" },
  );

  async function cloneEntry(suffix, transformEntry = (entry) => entry) {
    const cloneKey = sha256(suffix);
    const sourceDirectory = path.join(repositoryCacheRoot, evidenceKey);
    const cloneDirectory = path.join(repositoryCacheRoot, cloneKey);
    await mkdir(cloneDirectory, { recursive: true });
    for (const artifactName of ["mutation-report.json", "mutation-report.html"]) {
      await writeFile(
        path.join(cloneDirectory, artifactName),
        await readFile(path.join(sourceDirectory, artifactName)),
      );
    }
    const originalEntry = JSON.parse(await readFile(path.join(sourceDirectory, "entry.json"), "utf8"));
    await writeFile(
      path.join(cloneDirectory, "entry.json"),
      `${JSON.stringify(transformEntry({ ...originalEntry, evidenceKey: cloneKey }))}\n`,
    );
    return { cloneDirectory, cloneKey };
  }

  const rejectedEntries = [];
  for (const result of ["failed", "pending"]) {
    const clone = await cloneEntry(result, (entry) => ({ ...entry, result }));
    rejectedEntries.push([clone.cloneKey, "result-not-passed"]);
  }
  const partial = await cloneEntry("partial");
  await rm(path.join(partial.cloneDirectory, "mutation-report.html"));
  rejectedEntries.push([partial.cloneKey, "artifact-missing"]);
  const tampered = await cloneEntry("tampered");
  await writeFile(path.join(tampered.cloneDirectory, "mutation-report.json"), '{"tampered":true}\n');
  rejectedEntries.push([tampered.cloneKey, "artifact-hash-mismatch"]);
  const wrongSchema = await cloneEntry("wrong-schema", (entry) => ({ ...entry, schemaVersion: 999 }));
  rejectedEntries.push([wrongSchema.cloneKey, "schema-version-mismatch"]);
  const wrongKey = await cloneEntry("wrong-key", (entry) => ({ ...entry, evidenceKey }));
  rejectedEntries.push([wrongKey.cloneKey, "evidence-key-mismatch"]);
  const unsafePersisted = await cloneEntry("unsafe-persisted", (entry) => ({
    ...entry,
    runtimeProfile: {
      platform: "linux",
      nested: { authorization: secretSentinel },
    },
  }));
  rejectedEntries.push([unsafePersisted.cloneKey, "entry-metadata-invalid"]);
  const symlinkedEntry = await cloneEntry("symlinked-entry");
  const externalEntryJson = path.join(cacheFixture, "external-entry.json");
  await writeFile(
    externalEntryJson,
    await readFile(path.join(symlinkedEntry.cloneDirectory, "entry.json")),
  );
  await rm(path.join(symlinkedEntry.cloneDirectory, "entry.json"));
  await symlink(externalEntryJson, path.join(symlinkedEntry.cloneDirectory, "entry.json"));
  rejectedEntries.push([symlinkedEntry.cloneKey, "entry-invalid"]);
  const symlinkedArtifactParent = await cloneEntry("symlinked-artifact-parent", (entry) => ({
    ...entry,
    artifacts: {
      nested: entry.artifacts["mutation-report.json"],
    },
  }));
  const externalArtifacts = path.join(cacheFixture, "external-artifacts");
  await mkdir(externalArtifacts);
  await writeFile(
    path.join(externalArtifacts, "report.json"),
    await readFile(path.join(symlinkedArtifactParent.cloneDirectory, "mutation-report.json")),
  );
  await symlink(externalArtifacts, path.join(symlinkedArtifactParent.cloneDirectory, "nested"));
  const symlinkedArtifactEntry = JSON.parse(
    await readFile(path.join(symlinkedArtifactParent.cloneDirectory, "entry.json"), "utf8"),
  );
  symlinkedArtifactEntry.artifacts = {
    "nested/report.json": symlinkedArtifactEntry.artifacts.nested,
  };
  await writeFile(
    path.join(symlinkedArtifactParent.cloneDirectory, "entry.json"),
    `${JSON.stringify(symlinkedArtifactEntry)}\n`,
  );
  rejectedEntries.push([symlinkedArtifactParent.cloneKey, "artifact-missing"]);
  const traversingArtifact = await cloneEntry("traversing-artifact", (entry) => ({
    ...entry,
    artifacts: { "../external-report.json": entry.artifacts["mutation-report.json"] },
  }));
  rejectedEntries.push([traversingArtifact.cloneKey, "artifact-manifest-invalid"]);
  const absoluteArtifact = await cloneEntry("absolute-artifact", (entry) => ({
    ...entry,
    artifacts: { [reportSource]: entry.artifacts["mutation-report.json"] },
  }));
  rejectedEntries.push([absoluteArtifact.cloneKey, "artifact-manifest-invalid"]);
  const truncated = await cloneEntry("truncated");
  await writeFile(path.join(truncated.cloneDirectory, "entry.json"), '{"schemaVersion":1');
  rejectedEntries.push([truncated.cloneKey, "entry-invalid"]);

  for (const [rejectedKey, reason] of rejectedEntries) {
    let called = false;
    assert.deepEqual(
      readCacheEntry({
        root: repositoryCacheRoot,
        evidenceKey: rejectedKey,
        validateArtifacts: () => {
          called = true;
          return true;
        },
      }),
      { hit: false, reason },
    );
    assert.equal(called, false);
  }
  assert.deepEqual(
    readCacheEntry({
      root: repositoryCacheRoot,
      evidenceKey,
      validateArtifacts: () => false,
    }),
    { hit: false, reason: "artifact-validation-failed" },
  );

  const interruptedKey = sha256("interrupted-write");
  await mkdir(path.join(repositoryCacheRoot, `.${interruptedKey}.temporary`), { recursive: true });
  assert.deepEqual(
    readCacheEntry({
      root: repositoryCacheRoot,
      evidenceKey: interruptedKey,
      validateArtifacts: () => true,
    }),
    { hit: false, reason: "not-found" },
  );

  assert.throws(
    () => writeSuccessfulCacheEntry({
      root: repositoryCacheRoot,
      evidenceKey: sha256("failed-write"),
      entry: { result: "failed" },
      artifacts: { "mutation-report.json": reportSource },
    }),
    /passed/i,
  );
  assert.equal(
    (await readdir(repositoryCacheRoot)).some((name) => name.includes("failed-write")),
    false,
  );

  const cacheCli = new URL("./mutation-cache.mjs", import.meta.url).pathname;
  const inspectOutput = execFileSync(process.execPath, [cacheCli, "inspect"], {
    cwd: linkedWorktree,
    encoding: "utf8",
  });
  assert.equal(
    inspectOutput,
    `Mutation cache: ${repositoryCacheRoot}\nEntries: 13\n`,
  );
  assert.throws(
    () => execFileSync(process.execPath, [cacheCli, "clear", cacheFixture], {
      cwd: linkedWorktree,
      encoding: "utf8",
      stdio: "pipe",
    }),
    (error) => error.status === 2 && error.stderr === "Usage: mutation-cache.mjs <inspect|clear>\n",
  );

  const cleared = clearMutationCache({ repoRoot: linkedWorktree, runGit: runFixtureGit(linkedWorktree) });
  assert.equal(cleared.root, repositoryCacheRoot);
  assert.equal(cleared.count, 13);
  await assert.rejects(readFile(path.join(repositoryCacheRoot, evidenceKey, "entry.json")), /ENOENT/);

  const outsideDirectory = path.join(cacheFixture, "outside-do-not-delete");
  await mkdir(outsideDirectory);
  await writeFile(path.join(outsideDirectory, "sentinel"), "preserve\n");
  await mkdir(path.dirname(repositoryCacheRoot), { recursive: true });
  await symlink(outsideDirectory, repositoryCacheRoot);
  assert.throws(
    () => clearMutationCache({ repoRoot: repository, runGit: runFixtureGit(repository) }),
    /refusing|validated cache path/i,
  );
  assert.equal(await readFile(path.join(outsideDirectory, "sentinel"), "utf8"), "preserve\n");
  cacheContractCompleted = true;
} finally {
  await rm(cacheFixture, { recursive: true, force: true });
}
assert.equal(cacheContractCompleted, true);

function sequenceClock(...values) {
  let index = 0;
  return () => {
    assert.ok(index < values.length, "monotonic clock sequence exhausted");
    return values[index++];
  };
}

function sequenceValue(...values) {
  let index = 0;
  const next = () => {
    assert.ok(index < values.length, "injected value sequence exhausted");
    next.calls += 1;
    return values[index++];
  };
  next.calls = 0;
  return next;
}

const machine = {
  os: "TestOS 1",
  arch: "test64",
  logicalCpuCount: 8,
  memoryBytes: 16_000_000_000,
  toolVersions: { node: "22.12.0", stryker: "9.0.0" },
};
const provenance = {
  campaignKey: "campaign-123",
  head: "head-commit",
  base: "base-commit",
  baseRef: "main",
};
for (const invalidProvenance of [
  { ...provenance, head: "" },
  { ...provenance, base: undefined },
  { ...provenance, baseRef: "" },
]) {
  assert.throws(
    () => createPerformanceRun({ provenance: invalidProvenance, cacheMode: "enabled", machine }),
    (error) => error.message === "Invalid performance provenance",
  );
}
assert.throws(
  () => createPerformanceRun({ provenance, cacheMode: "sometimes", machine }),
  (error) => error.message === "Invalid cache mode",
);
assert.throws(
  () => createPerformanceRun({
    provenance,
    cacheMode: "enabled",
    machine: { ...machine, toolVersions: {} },
  }),
  (error) => error.message === "Invalid machine profile",
);

const invalidDecisionClock = sequenceClock(0, 10, 20, 30);
const invalidDecisionRun = createPerformanceRun({
  provenance,
  cacheMode: "bypass",
  machine,
  now: invalidDecisionClock,
  wallNow: sequenceValue("2026-08-12T10:00:00.000Z", "2026-08-12T10:00:01.000Z"),
  createRunId: sequenceValue("invalid-decision-run", "invalid-decision-temporary"),
  createShardToken: sequenceValue("invalid-decision-token"),
});
const invalidDecisionToken = startShard(invalidDecisionRun, {
  id: "strict-contract",
  evidenceKey: "strict-evidence",
  classification: "mutation",
}, invalidDecisionClock);
for (const [decision, details] of [
  ["executed", {}],
  ["executed", { result: "passed", rejectionReason: "not-allowed" }],
  ["executed", { result: "passed", durationMs: 999 }],
  ["reused", { result: "passed" }],
  ["reused", { result: "passed", priorDurationMs: -1 }],
  ["reused", { result: "failed", priorDurationMs: 10 }],
  ["reused", { result: "passed", priorDurationMs: 10, rejectionReason: "not-allowed" }],
  ["rejected", { result: "passed" }],
  ["rejected", { rejectionReason: "invalid-entry" }],
  ["unknown", { result: "passed" }],
]) {
  assert.throws(
    () => finishShard(invalidDecisionRun, invalidDecisionToken, decision, details, invalidDecisionClock),
    (error) => error.message === "Invalid shard completion",
  );
  assert.deepEqual(invalidDecisionRun.shards[0], {
    id: "strict-contract",
    evidenceKey: "strict-evidence",
    classification: "mutation",
    status: "started",
  });
}
assert.throws(
  () => finishPerformanceRun(invalidDecisionRun, "passed", invalidDecisionClock),
  (error) => error.message === "Cannot finish a run with active shards",
);
finishShard(
  invalidDecisionRun,
  invalidDecisionToken,
  "executed",
  { result: "failed" },
  invalidDecisionClock,
);
assert.throws(
  () => finishPerformanceRun(invalidDecisionRun, "green", invalidDecisionClock),
  (error) => error.message === "Invalid campaign outcome",
);
assert.throws(
  () => finishPerformanceRun(invalidDecisionRun, "passed", invalidDecisionClock),
  (error) => error.message === "Invalid campaign outcome",
);
finishPerformanceRun(invalidDecisionRun, "failed", invalidDecisionClock);

for (const failure of ["clock", "token"]) {
  const transactionalRun = createPerformanceRun({
    provenance,
    cacheMode: "enabled",
    machine,
    now: sequenceClock(0),
    wallNow: sequenceValue("2026-08-12T11:00:00.000Z"),
    createRunId: sequenceValue(`${failure}-failure-run`),
    createShardToken: failure === "token"
      ? () => { throw new Error("token failure"); }
      : sequenceValue("clock-failure-token"),
  });
  assert.throws(
    () => startShard(transactionalRun, {
      id: "transactional",
      evidenceKey: "transactional-evidence",
      classification: "mutation",
    }, failure === "clock" ? () => { throw new Error("clock failure"); } : undefined),
    (error) => error.message === `${failure} failure`,
  );
  assert.deepEqual(transactionalRun.shards, []);
  assert.deepEqual(transactionalRun.totals, {
    shardCount: 0,
    executedCount: 0,
    reusedCount: 0,
    rejectedCount: 0,
    hitRatio: 0,
    estimatedMsSaved: 0,
  });
}

const coldClock = sequenceClock(100, 110, 150, 160, 260, 270, 290, 300);
const coldWallNow = sequenceValue("2026-08-12T12:00:00.000Z", "2026-08-12T12:00:03.000Z");
const coldCreateRunId = sequenceValue("cold-run", "cold-write");
const coldCreateShardToken = sequenceValue("cold-core-token", "cold-db-token", "cold-verification-token");
const coldRun = createPerformanceRun({
  provenance,
  cacheMode: "enabled",
  machine: { ...machine, environment: { SECRET: "must-not-persist" } },
  now: coldClock,
  wallNow: coldWallNow,
  createRunId: coldCreateRunId,
  createShardToken: coldCreateShardToken,
});
const coldFirst = startShard(coldRun, {
  id: "core",
  evidenceKey: "evidence-core",
  classification: "mutation",
}, coldClock);
assert.equal(coldFirst, "cold-core-token");
finishShard(coldRun, coldFirst, "executed", { result: "passed" }, coldClock);
const coldSecond = startShard(coldRun, {
  id: "db",
  evidenceKey: "evidence-db",
  classification: "db-backed",
}, coldClock);
assert.equal(coldSecond, "cold-db-token");
finishShard(coldRun, coldSecond, "executed", { result: "passed" }, coldClock);
const coldThird = startShard(coldRun, {
  id: "verification",
  evidenceKey: "evidence-verification",
  classification: "verification-only",
}, coldClock);
assert.equal(coldThird, "cold-verification-token");
finishShard(coldRun, coldThird, "executed", { result: "passed" }, coldClock);
finishPerformanceRun(coldRun, "passed", coldClock);
assert.deepEqual(coldRun.totals, {
  shardCount: 3,
  executedCount: 3,
  reusedCount: 0,
  rejectedCount: 0,
  hitRatio: 0,
  estimatedMsSaved: 0,
});
assert.deepEqual(coldRun.shards.map(({ durationMs }) => durationMs), [40, 100, 20]);
assert.equal(coldRun.wallClockDurationMs, 200);
assert.equal(coldRun.orchestrationDurationMs, 200);
assert.equal(coldRun.outcome, "passed");
assert.deepEqual(coldRun.machine, machine);
assert.equal(Object.hasOwn(coldRun.machine, "environment"), false);
assert.equal(coldRun.runId, "cold-run");
assert.equal(coldRun.startedAt, "2026-08-12T12:00:00.000Z");
assert.equal(coldRun.finishedAt, "2026-08-12T12:00:03.000Z");
assert.equal(coldWallNow.calls, 2);
assert.equal(coldCreateRunId.calls, 1);
assert.equal(coldCreateShardToken.calls, 3);

const warmClock = sequenceClock(500, 510, 515, 520, 528, 540, 550, 560);
const warmWallNow = sequenceValue("2026-08-12T12:01:00.000Z", "2026-08-12T12:01:01.000Z");
const warmCreateRunId = sequenceValue("warm-run", "warm-write");
const warmCreateShardToken = sequenceValue("warm-core-token", "warm-db-token", "warm-verification-token");
const warmRun = createPerformanceRun({
  provenance,
  cacheMode: "enabled",
  machine,
  now: warmClock,
  wallNow: warmWallNow,
  createRunId: warmCreateRunId,
  createShardToken: warmCreateShardToken,
});
const warmFirst = startShard(warmRun, {
  id: "core",
  evidenceKey: "evidence-core",
  classification: "mutation",
}, warmClock);
finishShard(warmRun, warmFirst, "reused", { priorDurationMs: 40, result: "passed" }, warmClock);
const warmSecond = startShard(warmRun, {
  id: "db",
  evidenceKey: "evidence-db",
  classification: "db-backed",
}, warmClock);
finishShard(warmRun, warmSecond, "rejected", {
  priorDurationMs: 100,
  rejectionReason: "artifact-hash-mismatch",
  result: "passed",
}, warmClock);
const warmThird = startShard(warmRun, {
  id: "verification",
  evidenceKey: "evidence-verification",
  classification: "verification-only",
}, warmClock);
finishShard(warmRun, warmThird, "executed", { result: "passed" }, warmClock);
finishPerformanceRun(warmRun, "passed", warmClock);
assert.deepEqual(warmRun.totals, {
  shardCount: 3,
  executedCount: 1,
  reusedCount: 1,
  rejectedCount: 1,
  hitRatio: 1 / 3,
  estimatedMsSaved: 40,
});
assert.deepEqual(warmRun.shards.map(({ durationMs }) => durationMs), [5, 8, 10]);
assert.equal(warmRun.wallClockDurationMs, 60);

const performanceFixture = await mkdtemp(path.join(tmpdir(), "ledger-mutation-performance-"));
try {
  const unfinishedRun = createPerformanceRun({
    provenance,
    cacheMode: "enabled",
    machine,
    now: sequenceClock(0, 1),
    wallNow: sequenceValue("2026-08-12T12:02:00.000Z"),
    createRunId: sequenceValue("unfinished-run", "unfinished-write"),
    createShardToken: sequenceValue("unfinished-token"),
  });
  startShard(unfinishedRun, {
    id: "unfinished",
    evidenceKey: "unfinished-evidence",
    classification: "mutation",
  });
  unfinishedRun.outcome = "passed";
  assert.throws(
    () => writePerformanceRecord(performanceFixture, unfinishedRun),
    (error) => error.message === "Cannot persist a passed run with active shards",
  );

  const recordPath = writePerformanceRecord(performanceFixture, warmRun);
  assert.equal(
    path.dirname(recordPath),
    path.join(await realpath(performanceFixture), "reports/mutation-performance"),
  );
  const persisted = JSON.parse(await readFile(recordPath, "utf8"));
  assert.deepEqual(persisted, warmRun);
  assert.equal(JSON.stringify(persisted).includes("environment"), false);
  assert.equal(
    (await readdir(path.dirname(recordPath))).some((name) => name.endsWith(".temporary")),
    false,
  );
  assert.equal(path.basename(recordPath), "warm-run.json");
  assert.equal(warmWallNow.calls, 2);
  assert.equal(warmCreateRunId.calls, 2);
  assert.equal(warmCreateShardToken.calls, 3);
  assert.throws(
    () => writePerformanceRecord(performanceFixture, structuredClone(warmRun)),
    (error) => error.message === "Invalid performance record",
  );
  const originalWarmTotals = warmRun.totals;
  warmRun.totals = { ...originalWarmTotals, reusedCount: 99 };
  assert.throws(
    () => writePerformanceRecord(performanceFixture, warmRun),
    (error) => error.message === "Invalid performance record",
  );
  warmRun.totals = originalWarmTotals;
  for (const [field, invalidValue] of [
    ["schemaVersion", 999],
    ["cacheSchemaVersion", 999],
    ["machine", { ...machine, logicalCpuCount: 0 }],
    ["provenance", { ...provenance, base: "" }],
    ["outcome", "incomplete"],
  ]) {
    const original = warmRun[field];
    warmRun[field] = invalidValue;
    assert.throws(
      () => writePerformanceRecord(performanceFixture, warmRun),
      (error) => error.message === "Invalid performance record",
    );
    warmRun[field] = original;
  }
  assert.throws(
    () => writePerformanceRecord(performanceFixture, {
      ...warmRun,
      environment: { DATABASE_URL: "must-not-persist" },
    }),
    /invalid performance record/i,
  );
  const symlinkWriteRoot = path.join(performanceFixture, "symlink-write-root");
  const symlinkWriteOutside = path.join(performanceFixture, "symlink-write-outside");
  await mkdir(symlinkWriteRoot);
  await mkdir(symlinkWriteOutside);
  await symlink(symlinkWriteOutside, path.join(symlinkWriteRoot, "reports"));
  assert.throws(
    () => writePerformanceRecord(symlinkWriteRoot, warmRun),
    (error) => error.message === "Unsafe performance record path",
  );
  assert.deepEqual(await readdir(symlinkWriteOutside), []);
  const nestedSymlinkRoot = path.join(performanceFixture, "nested-symlink-root");
  await mkdir(path.join(nestedSymlinkRoot, "reports"), { recursive: true });
  await symlink(
    symlinkWriteOutside,
    path.join(nestedSymlinkRoot, "reports", "mutation-performance"),
  );
  assert.throws(
    () => writePerformanceRecord(nestedSymlinkRoot, warmRun),
    (error) => error.message === "Unsafe performance record path",
  );

  const interruptedRun = createPerformanceRun({
    provenance,
    cacheMode: "enabled",
    machine,
    now: sequenceClock(1_000, 1_010, 1_025),
    wallNow: sequenceValue("2026-08-12T12:03:00.000Z", "2026-08-12T12:03:02.000Z"),
    createRunId: sequenceValue("interrupted-run", "interrupted-write"),
    createShardToken: sequenceValue("interrupted-shard-token"),
  });
  assert.equal(startShard(interruptedRun, {
    id: "interrupted-shard",
    evidenceKey: "interrupted-evidence",
    classification: "mutation",
  }), "interrupted-shard-token");
  finishPerformanceRun(interruptedRun, "interrupted");
  assert.equal(interruptedRun.outcome, "interrupted");
  assert.equal(interruptedRun.wallClockDurationMs, 25);
  assert.equal(interruptedRun.shards[0].status, "started");
  assert.throws(
    () => finishShard(
      interruptedRun,
      "interrupted-shard-token",
      "executed",
      { result: "passed" },
    ),
    (error) => error.message === "Performance run is already finished",
  );
  const interruptedPath = writePerformanceRecord(performanceFixture, interruptedRun);
  assert.deepEqual(JSON.parse(await readFile(interruptedPath, "utf8")), interruptedRun);
  assert.throws(
    () => renderBenchmarkSummary(coldRun, interruptedRun),
    (error) => error.message === "Benchmark records are incomparable: different workloads and campaign outcomes are not both passed",
  );
  const interruptedSummary = renderBenchmarkSummary(coldRun, interruptedRun, {
    allowIncomparable: true,
  });
  assert.match(interruptedSummary, /Comparable: no \(different workloads; campaign outcomes are not both passed\)/);
  assert.match(interruptedSummary, /Measured wall-clock savings \(ms\) \| incomparable/);
  assert.match(interruptedSummary, /Campaign outcome \| passed \| interrupted/);

  const failedRun = createPerformanceRun({
    provenance,
    cacheMode: "enabled",
    machine,
    now: sequenceClock(2_000, 2_010, 2_030),
    wallNow: sequenceValue("2026-08-12T12:04:00.000Z", "2026-08-12T12:04:02.000Z"),
    createRunId: sequenceValue("failed-run", "failed-write"),
    createShardToken: sequenceValue("failed-shard-token"),
  });
  startShard(failedRun, {
    id: "failed-active-shard",
    evidenceKey: "failed-active-evidence",
    classification: "mutation",
  });
  finishPerformanceRun(failedRun, "failed");
  assert.equal(failedRun.shards[0].status, "started");
  assert.deepEqual(
    JSON.parse(await readFile(writePerformanceRecord(performanceFixture, failedRun), "utf8")),
    failedRun,
  );

  const overflowRun = createPerformanceRun({
    provenance,
    cacheMode: "enabled",
    machine,
    now: sequenceClock(0, 1, 2, 3, 4),
    wallNow: sequenceValue("2026-08-12T12:05:00.000Z"),
    createRunId: sequenceValue("overflow-run"),
    createShardToken: sequenceValue("overflow-one", "overflow-two"),
  });
  const overflowOne = startShard(overflowRun, {
    id: "overflow-one",
    evidenceKey: "overflow-evidence-one",
    classification: "mutation",
  });
  finishShard(overflowRun, overflowOne, "reused", {
    result: "passed",
    priorDurationMs: Number.MAX_VALUE,
  });
  const overflowTwo = startShard(overflowRun, {
    id: "overflow-two",
    evidenceKey: "overflow-evidence-two",
    classification: "mutation",
  });
  assert.throws(
    () => finishShard(overflowRun, overflowTwo, "reused", {
      result: "passed",
      priorDurationMs: Number.MAX_VALUE,
    }),
    (error) => error.message === "Invalid performance aggregate",
  );
  assert.equal(overflowRun.shards[1].status, "started");
  assert.equal(overflowRun.totals.estimatedMsSaved, Number.MAX_VALUE);

  const summary = renderBenchmarkSummary(coldRun, warmRun);
  assert.equal(summary, `# Mutation cache benchmark

Comparable: yes

| Metric | Cold | Warm |
| --- | ---: | ---: |
| Wall-clock duration (ms) | 200 | 60 |
| Orchestration duration (ms) | 200 | 60 |
| Measured wall-clock savings (ms) | 140 | — |
| Shard count | 3 | 3 |
| Executed shards | 3 | 1 |
| Reused shards | 0 | 1 |
| Rejected cache entries | 0 | 1 |
| Hit ratio | 0 | 0.3333333333333333 |
| Estimated cache savings (ms) | 0 | 40 |
| Campaign outcome | passed | passed |

> Measured wall-clock savings are the cold-minus-warm elapsed durations. Estimated cache savings sum prior recorded durations for reused shards and are not wall-clock measurements.
`);
  assert.match(
    renderBenchmarkSummary(coldRun, {
      ...warmRun,
      provenance: { ...warmRun.provenance, head: "metadata-only-head" },
      shards: [...warmRun.shards].reverse(),
    }),
    /Comparable: yes/,
  );

  for (const [record, expected] of [
    [{ ...warmRun, schemaVersion: 999 }, "Invalid performance record"],
    [{ ...warmRun, totals: { ...warmRun.totals, hitRatio: Number.NaN } }, "Invalid performance record"],
    [{ ...warmRun, totals: { ...warmRun.totals, shardCount: 999 } }, "Invalid performance record"],
  ]) {
    assert.throws(
      () => renderBenchmarkSummary(coldRun, record, { allowIncomparable: true }),
      (error) => error.message === expected,
    );
  }
  const differentWorkload = {
    ...warmRun,
    shards: warmRun.shards.map((shard, index) => index === 0
      ? { ...shard, evidenceKey: "different-evidence" }
      : { ...shard }),
  };
  assert.throws(
    () => renderBenchmarkSummary(coldRun, differentWorkload),
    (error) => /different workloads/.test(error.message),
  );
  assert.match(
    renderBenchmarkSummary(coldRun, differentWorkload, { allowIncomparable: true }),
    /Comparable: no \(different workloads\)/,
  );
  const differentBase = {
    ...warmRun,
    provenance: { ...warmRun.provenance, base: "different-base" },
  };
  assert.throws(
    () => renderBenchmarkSummary(coldRun, differentBase),
    (error) => /different base provenance/.test(error.message),
  );

  const coldPath = path.join(performanceFixture, "cold.json");
  const warmPath = path.join(performanceFixture, "warm.json");
  await writeFile(coldPath, `${JSON.stringify(coldRun)}\n`);
  await writeFile(warmPath, `${JSON.stringify(warmRun)}\n`);
  const performanceCli = new URL("./mutation-evidence/performance.mjs", import.meta.url).pathname;
  assert.equal(
    execFileSync(process.execPath, [performanceCli, coldPath, warmPath], { encoding: "utf8" }),
    summary,
  );

  const otherMachinePath = path.join(performanceFixture, "other-machine.json");
  await writeFile(otherMachinePath, `${JSON.stringify({
    ...warmRun,
    machine: { ...machine, arch: "other64" },
  })}\n`);
  assert.throws(
    () => execFileSync(process.execPath, [performanceCli, coldPath, otherMachinePath], {
      encoding: "utf8",
      stdio: "pipe",
    }),
    (error) => error.status === 2 && /incomparable/i.test(error.stderr),
  );
  const incomparable = execFileSync(
    process.execPath,
    [performanceCli, "--allow-incomparable", coldPath, otherMachinePath],
    { encoding: "utf8" },
  );
  assert.match(incomparable, /Comparable: no \(different machine profiles\)/);
  assert.match(incomparable, /Measured wall-clock savings \(ms\) \| incomparable/);

  const otherCampaignPath = path.join(performanceFixture, "other-campaign.json");
  await writeFile(otherCampaignPath, `${JSON.stringify({
    ...warmRun,
    provenance: { ...provenance, campaignKey: "another-campaign" },
  })}\n`);
  assert.throws(
    () => execFileSync(process.execPath, [performanceCli, coldPath, otherCampaignPath], {
      encoding: "utf8",
      stdio: "pipe",
    }),
    (error) => error.status === 2 && /different campaign keys/i.test(error.stderr),
  );

  assert.throws(
    () => execFileSync(process.execPath, [performanceCli, coldPath], {
      encoding: "utf8",
      stdio: "pipe",
    }),
    (error) => error.status === 2 && /exactly two/i.test(error.stderr),
  );
} finally {
  await rm(performanceFixture, { recursive: true, force: true });
}
