import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  CACHE_SCHEMA_VERSION,
  cacheRoot,
  clearMutationCache,
  projectMutationReportArtifact,
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
    ["@mutation-evidence/dependency-resolver.json", sha256(canonicalJson({ version: 5 }))],
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
    "packages/db/package.json": '{"name":"@fixture/db","type":"module"}',
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
      "packages/db/package.json",
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

  await put(
    fixtureRoot,
    "scripts/root-filesystem.mjs",
    'import { readFileSync } from "node:fs";\nexport const read = readFileSync;\n',
  );
  for (const container of [".worktrees", "worktrees"]) {
    await put(
      fixtureRoot,
      `${container}/other/entry.mjs`,
      'import "./postgres-container.mjs";\n',
    );
    await put(
      fixtureRoot,
      `${container}/other/postgres-container.mjs`,
      'import { resolve } from "node:path";\nconst packageRoot = "ignored";\nconst migrationRunner = resolve(packageRoot, "scripts/apply-migrations.mjs");\nexport { migrationRunner };\n',
    );
  }
  const rootFileSystemClosure = collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["scripts/root-filesystem.mjs"],
    configurationFiles: [], migrationRoots: [], toolVersions, runtimeProfile,
  });
  assert.equal(rootFileSystemClosure.reusable, true);
  assert.equal(Object.keys(rootFileSystemClosure.hashes).some((file) =>
    /^(?:\.worktrees|worktrees)\//.test(file)), false);

  await put(
    fixtureRoot,
    "packages/app/src/explicit-worktree.ts",
    'import "../../../.worktrees/other/entry.mjs";\n',
  );
  const explicitWorktreeReference = collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/app/src/explicit-worktree.ts"],
    configurationFiles: [], migrationRoots: [], toolVersions, runtimeProfile,
  });
  assert.equal(explicitWorktreeReference.reusable, false);
  assert.ok(explicitWorktreeReference.reasons.some(({ code }) =>
    code === "nested-worktree-input"));

  await put(
    fixtureRoot,
    "packages/app/src/environment.ts",
    "export const endpoint = process.env.MAILPIT_TEST_SMTP_URL ?? process.env.API_ORIGIN;\n",
  );
  const serviceEnvironment = collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/app/src/environment.ts"],
    configurationFiles: [], migrationRoots: [], toolVersions, runtimeProfile,
    environment: {
      MAILPIT_TEST_SMTP_URL: "smtp://mailpit.internal:1025",
      API_ORIGIN: "https://ledger.internal",
    },
  });
  assert.equal(serviceEnvironment.reusable, false);
  assert.equal(canonicalJson(serviceEnvironment).includes("mailpit.internal"), false);
  assert.equal(canonicalJson(serviceEnvironment).includes("ledger.internal"), false);
  assert.equal(collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/app/src/environment.ts"],
    configurationFiles: [], migrationRoots: [], toolVersions, runtimeProfile,
    environment: {},
  }).reusable, true, "absent service inputs are deterministic and contain no secret material");
  await put(
    fixtureRoot,
    "node_modules/fixture-alias/package.json",
    JSON.stringify({ name: "fixture-real", version: "1.2.3", main: "index.js" }),
  );
  await put(fixtureRoot, "node_modules/fixture-alias/index.js", "module.exports = 'aliased';\n");
  await put(
    fixtureRoot,
    "packages/app/src/alias.ts",
    "import alias from 'fixture-alias'; export default alias;\n",
  );
  const aliasedDependency = collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/app/src/alias.ts"],
    configurationFiles: [], migrationRoots: [], toolVersions, runtimeProfile,
  });
  assert.equal(aliasedDependency.reusable, true);
  assert.ok(aliasedDependency.hashes["@installed/fixture-real@1.2.3/index.js"]);
  for (const owner of ["instance-a", "instance-b"]) {
    await put(
      fixtureRoot,
      `packages/${owner}/package.json`,
      JSON.stringify({ name: `@fixture/${owner}`, type: "module" }),
    );
    await put(
      fixtureRoot,
      `packages/${owner}/src/main.ts`,
      "import value from 'fixture-twin'; export default value;\n",
    );
    await put(
      fixtureRoot,
      `packages/${owner}/node_modules/fixture-twin/package.json`,
      JSON.stringify({
        name: "fixture-twin", version: "1.0.0", main: "index.js",
        peerDependencies: { "fixture-peer": "1.0.0" },
      }),
    );
    await put(
      fixtureRoot,
      `packages/${owner}/node_modules/fixture-twin/index.js`,
      `module.exports = ${JSON.stringify(owner)};\n`,
    );
    await put(
      fixtureRoot,
      `packages/${owner}/node_modules/fixture-peer/package.json`,
      JSON.stringify({ name: "fixture-peer", version: "1.0.0", main: "index.js" }),
    );
    await put(
      fixtureRoot,
      `packages/${owner}/node_modules/fixture-peer/index.js`,
      `module.exports = ${JSON.stringify(`peer-${owner}`)};\n`,
    );
  }
  const twinClosure = () => collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: [
      "packages/instance-a/src/main.ts",
      "packages/instance-b/src/main.ts",
    ],
    configurationFiles: [], migrationRoots: [], toolVersions, runtimeProfile,
  });
  const twinInputs = twinClosure();
  const twinPackageKeys = Object.keys(twinInputs.hashes)
    .filter((key) => key.startsWith("@installed/fixture-twin@1.0.0"));
  assert.equal(twinPackageKeys.length >= 4, true);
  assert.equal(twinPackageKeys.every((key) =>
    /^@installed\/fixture-twin@1\.0\.0#[a-f0-9]{16}\//.test(key)), true,
  "same-version instances must have distinct relocatable locators");
  assert.equal(new Set(twinPackageKeys.map((key) => key.split("/")[1])).size, 2);
  const twinBefore = sha256(canonicalJson(twinInputs.hashes));
  await put(
    fixtureRoot,
    "packages/instance-a/node_modules/fixture-twin/index.js",
    "module.exports = 'patched-instance-a';\n",
  );
  const twinAfterA = sha256(canonicalJson(twinClosure().hashes));
  assert.notEqual(twinAfterA, twinBefore, "patched bytes in the first same-version instance change the key");
  await put(
    fixtureRoot,
    "packages/instance-b/node_modules/fixture-peer/index.js",
    "module.exports = 'patched-peer-instance-b';\n",
  );
  assert.notEqual(
    sha256(canonicalJson(twinClosure().hashes)),
    twinAfterA,
    "peer bytes in the second same-version instance change the key",
  );
  await put(
    fixtureRoot,
    "packages/app/src/computed-worker.ts",
    'import { Worker } from "node:worker_threads";\nexport const run = (target: string) => new Worker(target);\n',
  );
  assert.equal(collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/app/src/computed-worker.ts"],
    configurationFiles: [], migrationRoots: [], toolVersions, runtimeProfile,
  }).reusable, false);

  await put(
    fixtureRoot,
    "packages/app/src/locale.ts",
    "export const locale = process.env.LANG; export const timezone = import.meta.env.TZ;\n",
  );
  const localeEnvironment = (environment) => collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/app/src/locale.ts"],
    configurationFiles: [], migrationRoots: [], toolVersions, runtimeProfile,
    environment,
  });
  const localeBefore = localeEnvironment({ LANG: "en_US.UTF-8", TZ: "UTC" });
  const localeAfter = localeEnvironment({ LANG: "es_EC.UTF-8", TZ: "America/Guayaquil" });
  assert.equal(localeBefore.reusable, true);
  assert.notEqual(
    localeBefore.hashes["@runtime/environment.json"],
    localeAfter.hashes["@runtime/environment.json"],
  );

  await put(
    fixtureRoot,
    "packages/app/src/holidays.ts",
    "export const holidays = process.env.ECUADOR_HOLIDAYS;\n",
  );
  const holidayEnvironment = (environment) => collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/app/src/holidays.ts"],
    configurationFiles: [], migrationRoots: [], toolVersions, runtimeProfile,
    environment,
  });
  const holidaysBefore = holidayEnvironment({ ECUADOR_HOLIDAYS: "2026-07-27" });
  const holidaysAfter = holidayEnvironment({ ECUADOR_HOLIDAYS: "2026-07-27, 2026-08-10" });
  const holidaysEmpty = holidayEnvironment({ ECUADOR_HOLIDAYS: "" });
  assert.equal(holidaysBefore.reusable, true);
  assert.equal(holidaysEmpty.reusable, true);
  assert.notEqual(
    holidaysBefore.hashes["@runtime/environment.json"],
    holidaysAfter.hashes["@runtime/environment.json"],
  );

  await put(
    fixtureRoot,
    "packages/db/src/harness.ts",
    "export const app = process.env.US017_MUTATION_DATABASE_URL;\nexport const owner = process.env.US017_MUTATION_DATABASE_ADMIN_URL;\n",
  );
  const databaseEnvironment = collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/db/src/harness.ts"],
    configurationFiles: [], migrationRoots: [], toolVersions,
    runtimeProfile: { ...runtimeProfile, databaseDriver: "postgres", databaseHarness: "us017", databaseServerVersion: "16.4", schemaFingerprint: "a".repeat(64) },
    environment: {
      US017_MUTATION_DATABASE_URL: "postgres://app:secret@db/ledger",
      US017_MUTATION_DATABASE_ADMIN_URL: "postgres://owner:secret@db/ledger",
    },
  });
  assert.equal(databaseEnvironment.reusable, true);
  assert.equal(canonicalJson(databaseEnvironment).includes("postgres://"), false);
  assert.equal(canonicalJson(databaseEnvironment).includes("US017"), false);

  const unrelatedDatabaseEnvironment = collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/db/src/harness.ts"],
    configurationFiles: [], migrationRoots: [], toolVersions,
    runtimeProfile: {
      ...runtimeProfile,
      databaseDriver: "postgres",
      databaseHarness: "us018",
      databaseServerVersion: "16.4",
      schemaFingerprint: "a".repeat(64),
    },
    environment: {
      US017_MUTATION_DATABASE_URL: "postgres://app:secret@db/ledger",
      US017_MUTATION_DATABASE_ADMIN_URL: "postgres://owner:secret@db/ledger",
    },
  });
  assert.equal(unrelatedDatabaseEnvironment.reusable, false);
  assert.deepEqual(unrelatedDatabaseEnvironment.reasons, [{
    code: "environment-runtime-input",
    workspace: "packages/db",
  }]);

  await put(
    fixtureRoot,
    "packages/db/scripts/apply-migrations.mjs",
    'import { readFileSync } from "node:fs";\nimport "./migration-helper.mjs";\nexport const read = readFileSync;\n',
  );
  await put(fixtureRoot, "packages/db/scripts/migration-helper.mjs", "export const helper = 1;\n");
  await put(fixtureRoot, "packages/db/.tmp/incidental-output.json", '{"secret":"ignored"}\n');
  await put(
    fixtureRoot,
    "packages/db/src/postgres-container.ts",
    [
      'import { execFile } from "node:child_process";',
      'import { resolve } from "node:path";',
      'import { promisify } from "node:util";',
      'const execFileAsync = promisify(execFile);',
      'const packageRoot = resolve(import.meta.dirname, "..");',
      'const migrationRunner = resolve(packageRoot, "scripts/apply-migrations.mjs");',
      'const appUrl = "sanitized-app-url";',
      'const ownerUrl = "sanitized-owner-url";',
      'export const migrate = () => execFileAsync(process.execPath, [migrationRunner], {',
      '  cwd: packageRoot,',
      '  env: { ...process.env, DATABASE_ADMIN_URL: ownerUrl, DATABASE_URL: appUrl },',
      '});',
      "",
    ].join("\n"),
  );
  const migrationRunnerInputs = collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/db/src/postgres-container.ts"],
    configurationFiles: [], migrationRoots: [], toolVersions, runtimeProfile,
  });
  assert.equal(migrationRunnerInputs.reusable, true);
  assert.ok(migrationRunnerInputs.hashes["packages/db/scripts/apply-migrations.mjs"]);
  assert.ok(migrationRunnerInputs.hashes["packages/db/scripts/migration-helper.mjs"]);
  const helperHash = migrationRunnerInputs.hashes["packages/db/scripts/migration-helper.mjs"];
  await put(fixtureRoot, "packages/db/scripts/migration-helper.mjs", "export const helper = 2;\n");
  assert.notEqual(collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/db/src/postgres-container.ts"],
    configurationFiles: [], migrationRoots: [], toolVersions, runtimeProfile,
  }).hashes["packages/db/scripts/migration-helper.mjs"], helperHash);

  await put(
    fixtureRoot,
    "packages/db/src/unsafe-migration.ts",
    [
      'import { execFile } from "node:child_process";',
      'import { resolve } from "node:path";',
      'const packageRoot = resolve(import.meta.dirname, "..");',
      'const migrationRunner = resolve(packageRoot, "scripts/apply-migrations.mjs");',
      'const unboundOptions = { env: { TOKEN: "argv-secret-must-not-be-persisted" } };',
      'export const migrate = () => execFile(process.execPath, [migrationRunner], { ...unboundOptions });',
      "",
    ].join("\n"),
  );
  const unboundMigrationOptions = collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/db/src/unsafe-migration.ts"],
    configurationFiles: [], migrationRoots: [], toolVersions, runtimeProfile,
  });
  assert.equal(unboundMigrationOptions.reusable, false);
  assert.equal(canonicalJson(unboundMigrationOptions).includes("argv-secret-must-not-be-persisted"), false);

  await put(
    fixtureRoot,
    "packages/app/src/computed-child.ts",
    'import { execFile } from "node:child_process";\nexport const run = (target: string) => execFile(process.execPath, [target]);\n',
  );
  assert.equal(collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/app/src/computed-child.ts"],
    configurationFiles: [], migrationRoots: [], toolVersions, runtimeProfile,
  }).reusable, false);

  const argvSecret = "argv-secret-must-not-be-persisted";
  const childProcessCases = [
    [
      "spawn-sync.ts",
      `import { spawnSync } from "node:child_process";\nexport const run = () => spawnSync("pnpm", ["test", "${argvSecret}"]);\n`,
    ],
    [
      "exec-file-sync.ts",
      `import { execFileSync as execute } from "node:child_process";\nexport const run = () => execute("pnpm", ["test", "${argvSecret}"]);\n`,
    ],
    [
      "exec-sync.ts",
      `import * as childProcess from "node:child_process";\nexport const run = () => childProcess.execSync("pnpm test ${argvSecret}");\n`,
    ],
    [
      "aliased-spawn-sync.ts",
      `import { spawnSync } from "node:child_process";\nconst execute = spawnSync;\nexport const run = () => execute("pnpm", ["test", "${argvSecret}"]);\n`,
    ],
  ];
  for (const [fileName, source] of childProcessCases) {
    const relativeFile = `packages/app/src/${fileName}`;
    await put(fixtureRoot, relativeFile, source);
    const result = collectExecutionInputs({
      root: fixtureRoot,
      entryFiles: [relativeFile],
      configurationFiles: [], migrationRoots: [], toolVersions, runtimeProfile,
    });
    assert.equal(result.reusable, false, `${fileName} must not reuse mutation evidence`);
    assert.deepEqual(result.reasons, [{
      code: "computed-child-execution-input",
      workspace: "packages/app",
    }]);
    assert.equal(canonicalJson(result).includes(argvSecret), false);
  }
  await put(
    fixtureRoot,
    ".tmp/stryker-fixture/sandbox/packages/db/src/testing/postgres-container.ts",
    [
      'import { execFile } from "node:child_process";',
      'import { resolve } from "node:path";',
      'const packageRoot = import.meta.dirname;',
      'const migrationRunner = resolve(packageRoot, "scripts/apply-migrations.mjs");',
      'export const run = () => execFile(process.execPath, [migrationRunner]);',
      "",
    ].join("\n"),
  );
  await put(
    fixtureRoot,
    "scripts/computed-root.ts",
    'import "./missing.js";\nimport { execFile } from "node:child_process";\nexport const run = (target: string) => execFile(process.execPath, [target]);\n',
  );
  const generatedSandboxInputs = collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["scripts/computed-root.ts"],
    configurationFiles: [], migrationRoots: [], toolVersions, runtimeProfile,
  });
  assert.equal(generatedSandboxInputs.reusable, false);
  assert.equal(
    Object.keys(generatedSandboxInputs.hashes).some((input) => input.startsWith(".tmp/")),
    false,
  );
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

  await put(
    fixtureRoot,
    "packages/uncertain/src/static-read.ts",
    'import { readFile } from "node:fs/promises";\nexport const data = readFile(new URL("./schema.sql", import.meta.url), "utf8");\n',
  );
  const staticRead = collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/uncertain/src/static-read.ts"],
    configurationFiles: [], migrationRoots: [], toolVersions, runtimeProfile,
  });
  assert.equal(staticRead.reusable, true);
  assert.ok(staticRead.hashes["packages/uncertain/src/schema.sql"]);
  assert.equal(staticRead.hashes["packages/uncertain/.env"], undefined);

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
      reasons: [{ code: "excluded-runtime-inputs", workspace: "packages/safe" }],
      reusable: false,
    },
  );
  await put(fixtureRoot, "packages/safe/src/no-fs.ts", "export const value = 1;\n");
  const noFileSystemFallback = collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/safe/src/no-fs.ts"],
    configurationFiles: [], migrationRoots: [], toolVersions, runtimeProfile,
  });
  assert.equal(noFileSystemFallback.reusable, true);
  assert.equal(Object.keys(noFileSystemFallback.hashes).some((file) =>
    /packages\/safe\/(?:dist|build|reports|\.tmp)\//.test(file)), false);
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
  assert.equal(symlinkNodeModulesResult.reusable, false);
  assert.ok(symlinkNodeModulesResult.reasons.some(({ code }) => code === "symlink-runtime-input"));

  await put(
    fixtureRoot,
    "node_modules/fixture-third-party/package.json",
    '{"name":"fixture-third-party","version":"1.0.0","types":"index.d.ts","main":"index.js"}',
  );
  await put(
    fixtureRoot,
    "node_modules/fixture-third-party/index.d.ts",
    "export declare const thirdParty: boolean;\n",
  );
  await put(
    fixtureRoot,
    "node_modules/fixture-third-party/index.js",
    "export const thirdParty = true;\n",
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
  assert.ok(thirdPartyResult.hashes["@installed/fixture-third-party@1.0.0/package.json"]);
  assert.ok(thirdPartyResult.hashes["@installed/fixture-third-party@1.0.0/index.js"]);
  const installedRuntimeHash = thirdPartyResult.hashes["@installed/fixture-third-party@1.0.0/index.js"];
  await put(
    fixtureRoot,
    "node_modules/fixture-third-party/index.js",
    "export const thirdParty = false;\n",
  );
  assert.notEqual(collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/vendor-user/src/main.ts"],
    configurationFiles: [], migrationRoots: [], toolVersions, runtimeProfile,
  }).hashes["@installed/fixture-third-party@1.0.0/index.js"], installedRuntimeHash);

  await put(
    fixtureRoot,
    "packages/vendor-user/src/path-import.ts",
    'import { thirdParty } from "../../../node_modules/fixture-third-party/index.js";\nexport const value = thirdParty;\n',
  );
  const installedPathResult = collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/vendor-user/src/path-import.ts"],
    configurationFiles: [], migrationRoots: [], toolVersions, runtimeProfile,
  });
  assert.equal(installedPathResult.reusable, true);
  assert.ok(installedPathResult.hashes["@installed/fixture-third-party@1.0.0/index.js"]);

  await put(
    fixtureRoot,
    "packages/tool/node_modules/fixture-tool/package.json",
    JSON.stringify({ name: "fixture-tool", version: "1.0.0", main: "index.js" }),
  );
  await put(
    fixtureRoot,
    "packages/tool/node_modules/fixture-tool/index.js",
    "export const tool = true;\n",
  );
  await put(
    fixtureRoot,
    "packages/vendor-user/src/tool-path-import.ts",
    'import { tool } from "../../tool/node_modules/fixture-tool/index.js";\nexport const value = tool;\n',
  );
  const toolPathResult = collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/vendor-user/src/tool-path-import.ts"],
    configurationFiles: [], migrationRoots: [], toolVersions, runtimeProfile,
  });
  assert.equal(toolPathResult.reusable, true);
  assert.ok(toolPathResult.hashes["@installed/fixture-tool@1.0.0/index.js"]);

  await put(
    fixtureRoot,
    "node_modules/fixture-parent/package.json",
    JSON.stringify({
      name: "fixture-parent", version: "1.0.0", main: "index.js",
      dependencies: { "fixture-child": "1.0.0", "fixture-manifest-only": "1.0.0" },
      optionalDependencies: { "fixture-optional": "1.0.0", "fixture-absent": "1.0.0" },
      peerDependencies: { "fixture-peer": "1.0.0" },
    }),
  );
  await put(fixtureRoot, "node_modules/fixture-parent/index.js", "module.exports = true;\n");
  await put(
    fixtureRoot,
    "node_modules/fixture-manifest-only/package.json",
    JSON.stringify({
      name: "fixture-manifest-only",
      version: "1.0.0",
      exports: { "./package.json": "./package.json" },
    }),
  );
  for (const dependency of ["fixture-child", "fixture-optional", "fixture-peer"]) {
    await put(
      fixtureRoot,
      `node_modules/${dependency}/package.json`,
      JSON.stringify({ name: dependency, version: "1.0.0", main: "index.js" }),
    );
    await put(fixtureRoot, `node_modules/${dependency}/index.js`, `module.exports = ${JSON.stringify(dependency)};\n`);
  }
  await put(
    fixtureRoot,
    "packages/vendor-user/src/parent.ts",
    'import parent from "fixture-parent";\nexport default parent;\n',
  );
  const parentClosure = () => collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/vendor-user/src/parent.ts"],
    configurationFiles: [], migrationRoots: [], toolVersions, runtimeProfile,
  });
  const parentResult = parentClosure();
  assert.equal(parentResult.reusable, true);
  assert.ok(parentResult.hashes["@installed/fixture-manifest-only@1.0.0/package.json"]);
  for (const dependency of ["fixture-child", "fixture-optional", "fixture-peer"]) {
    assert.ok(parentResult.hashes[`@installed/${dependency}@1.0.0/index.js`]);
  }
  assert.ok(parentResult.hashes["@installed-absence/fixture-parent@1.0.0/optional/fixture-absent"]);
  const parentKey = sha256(canonicalJson(parentResult.hashes));
  await put(fixtureRoot, "node_modules/fixture-optional/index.js", "module.exports = 'changed';\n");
  const optionalMutationKey = sha256(canonicalJson(parentClosure().hashes));
  assert.notEqual(optionalMutationKey, parentKey);
  await put(fixtureRoot, "node_modules/fixture-peer/index.js", "module.exports = 'peer changed';\n");
  assert.notEqual(sha256(canonicalJson(parentClosure().hashes)), optionalMutationKey);
  await rm(path.join(fixtureRoot, "node_modules/fixture-peer"), { recursive: true, force: true });
  const missingPeer = parentClosure();
  assert.equal(missingPeer.reusable, false);
  assert.ok(missingPeer.reasons.some(({ code }) =>
    ["external-local-dependency", "symlink-runtime-input"].includes(code)));

  for (const plugin of ["@stryker-mutator/vitest-runner", "fixture-stryker-plugin"]) {
    await put(
      fixtureRoot,
      `node_modules/${plugin}/package.json`,
      JSON.stringify({ name: plugin, version: "1.0.0", main: "index.js" }),
    );
    await put(fixtureRoot, `node_modules/${plugin}/index.js`, `module.exports = ${JSON.stringify(plugin)};\n`);
  }
  await put(
    fixtureRoot,
    "stryker.plugins.json",
    JSON.stringify({ testRunner: "vitest", plugins: [
      "@stryker-mutator/vitest-runner", "fixture-stryker-plugin",
    ] }),
  );
  const pluginClosure = () => collectExecutionInputs({
    root: fixtureRoot,
    entryFiles: ["packages/app/src/helper.ts"],
    configurationFiles: ["stryker.plugins.json"],
    migrationRoots: [], toolVersions, runtimeProfile,
  });
  const pluginResult = pluginClosure();
  assert.ok(pluginResult.hashes["@installed/@stryker-mutator/vitest-runner@1.0.0/index.js"]);
  assert.ok(pluginResult.hashes["@installed/fixture-stryker-plugin@1.0.0/index.js"]);
  const pluginKey = sha256(canonicalJson(pluginResult.hashes));
  await put(
    fixtureRoot,
    "node_modules/@stryker-mutator/vitest-runner/index.js",
    "module.exports = 'byte mutation';\n",
  );
  assert.notEqual(sha256(canonicalJson(pluginClosure().hashes)), pluginKey);
} finally {
  delete process.env.LEDGER_FINGERPRINT_SECRET_SENTINEL;
  await rm(fixtureRoot, { recursive: true, force: true });
  await rm(symlinkTargetRoot, { recursive: true, force: true });
}

const repositoryProbe = collectExecutionInputs({
  root: path.resolve(new URL("..", import.meta.url).pathname),
  entryFiles: ["scripts/mutation-scope.mjs"],
  configurationFiles: ["stryker.conf.json"],
  migrationRoots: [],
  toolVersions: { node: process.versions.node },
  runtimeProfile: { arch: process.arch, platform: process.platform },
  // Keep this repository-shape assertion hermetic when the parent test process
  // legitimately carries database credentials (for example, during the full
  // Definition-of-Done gate). The package-manager executable remains an
  // intentional fingerprint input and is asserted below.
  environment: { npm_execpath: process.env.npm_execpath },
});
assert.equal(repositoryProbe.reusable, false);
assert.equal(repositoryProbe.reasons.some(({ code }) => code === "environment-runtime-input"), false);
assert.ok(repositoryProbe.hashes["scripts/mutation-scope.mjs"]);
for (const tool of [
  "typescript@", "vitest@", "@stryker-mutator/core@", "@stryker-mutator/vitest-runner@",
]) {
  assert.ok(Object.keys(repositoryProbe.hashes).some((input) =>
    input.startsWith(`@installed/${tool}`)), `${tool} installed bytes must be fingerprinted`);
}
assert.ok(repositoryProbe.hashes["@tool/pnpm-executable"]);
assert.equal(Object.keys(repositoryProbe.hashes).some((input) =>
  /^(?:\.worktrees|worktrees)\//.test(input)), false);

const connectorDispatchProbe = collectExecutionInputs({
  root: path.resolve(new URL("..", import.meta.url).pathname),
  entryFiles: ["packages/connectors/src/dispatch.test.ts"],
  configurationFiles: [],
  migrationRoots: [],
  toolVersions: { node: process.versions.node },
  runtimeProfile: { arch: process.arch, platform: process.platform },
});
assert.equal(connectorDispatchProbe.reusable, false);
assert.ok(connectorDispatchProbe.reasons.some(({ code, workspace }) =>
  code === "computed-child-execution-input" && workspace === "packages/connectors"));

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
  assert.equal(repositoryCacheRoot, path.join(commonDirectory, "ledger-mutation-cache", "v2"));
  assert.equal(linkedCacheRoot, repositoryCacheRoot);
  assert.equal(CACHE_SCHEMA_VERSION, 2);

  const evidenceKey = sha256("successful-cache-entry");
  const reportSource = path.join(cacheFixture, "mutation-report.json");
  const htmlSource = path.join(cacheFixture, "mutation-report.html");
  const secretSentinel = "postgres://cache-secret:do-not-write@example.invalid/ledger";
  await writeFile(reportSource, JSON.stringify({
    config: {
      mutate: [secretSentinel], configFile: secretSentinel,
      jsonReporter: { fileName: secretSentinel },
    },
    files: {
      "source.ts": {
        source: secretSentinel,
        mutants: [{
          id: "0", mutatorName: "BooleanLiteral", replacement: secretSentinel,
          location: { start: { line: 1, column: 20 }, end: { line: 1, column: 24 } },
          status: "Killed", statusReason: secretSentinel,
          testsCompleted: 1, killedBy: [secretSentinel], coveredBy: [secretSentinel],
        }],
      },
    },
    diagnostics: secretSentinel,
    testFiles: [{ name: secretSentinel }],
  }));
  await writeFile(htmlSource, `<html>${secretSentinel}</html>\n`);
  const mutationArtifactProjectors = {
    "mutation-report.json": projectMutationReportArtifact,
  };
  writeSuccessfulCacheEntry({
    root: repositoryCacheRoot,
    evidenceKey,
    entry: {
      result: "passed",
      shardKind: "stryker",
      durationMs: 125,
      dependencyHashes: {
        "@installed/example@1.0.0/token-map.js": sha256("installed token-map bytes"),
      },
    },
    artifacts: {
      "mutation-report.json": reportSource,
    },
    artifactProjectors: mutationArtifactProjectors,
  });
  assert.deepEqual(
    readCacheEntry({
      root: repositoryCacheRoot,
      evidenceKey,
      validateArtifacts: () => true,
    }).entry.dependencyHashes,
    { "@installed/example@1.0.0/token-map.js": sha256("installed token-map bytes") },
  );

  assert.throws(() => writeSuccessfulCacheEntry({
    root: repositoryCacheRoot,
    evidenceKey: sha256("html-forbidden"),
    entry: { result: "passed", shardKind: "stryker" },
    artifacts: { "mutation-report.html": htmlSource },
    artifactProjectors: { "mutation-report.html": (value) => value },
  }), /artifact|allowlist|projector/i);
  const projectionSource = path.join(cacheFixture, "projection-evidence.json");
  await writeFile(projectionSource, JSON.stringify({
    sourceHash: "a".repeat(64), resultHash: "b".repeat(64),
    endpoint: secretSentinel, password: secretSentinel,
  }));
  const projectionKey = sha256("projected-evidence");
  writeSuccessfulCacheEntry({
    root: repositoryCacheRoot,
    evidenceKey: projectionKey,
    entry: { result: "passed", shardKind: "stryker", classification: "verification-only" },
    artifacts: { "projection-evidence.json": projectionSource },
    artifactProjectors: {
      "projection-evidence.json": (value) => ({
        sourceHash: value.sourceHash,
        resultHash: value.resultHash,
      }),
    },
  });
  const projectedEvidence = await readFile(
    path.join(repositoryCacheRoot, projectionKey, "projection-evidence.json"), "utf8",
  );
  assert.equal(projectedEvidence.includes(secretSentinel), false);
  assert.deepEqual(JSON.parse(projectedEvidence), {
    resultHash: "b".repeat(64), sourceHash: "a".repeat(64),
  });
  assert.throws(() => writeSuccessfulCacheEntry({
    root: repositoryCacheRoot,
    evidenceKey: sha256("unknown-artifact"),
    entry: { result: "passed", shardKind: "stryker" },
    artifacts: { "unknown.json": reportSource },
    artifactProjectors: { "unknown.json": (value) => value },
  }), /artifact|allowlist|projector/i);

  let validatorCalls = 0;
  const hit = readCacheEntry({
    root: linkedCacheRoot,
    evidenceKey,
    validateArtifacts(artifacts, entry) {
      validatorCalls += 1;
      assert.equal(entry.result, "passed");
      assert.deepEqual(Object.keys(artifacts), ["mutation-report.json"]);
      const projected = JSON.parse(execFileSync("node", ["-e", `process.stdout.write(require('fs').readFileSync(${JSON.stringify(artifacts["mutation-report.json"])}, 'utf8'))`], { encoding: "utf8" }));
      assert.deepEqual(Object.keys(projected).sort(), ["config", "files"]);
      assert.equal("source" in projected.files["source.ts"], false);
      assert.match(projected.files["source.ts"].sourceHash, /^[a-f0-9]{64}$/);
      assert.deepEqual(Object.keys(projected.files["source.ts"].mutants[0]).sort(), [
        "id", "location", "mutatorName", "status",
      ]);
      return true;
    },
  });
  assert.equal(hit.hit, true);
  assert.equal(hit.entry.evidenceKey, evidenceKey);
  assert.equal(hit.entry.result, "passed");
  assert.equal(validatorCalls, 1);
  const persistedEntry = await readFile(path.join(repositoryCacheRoot, evidenceKey, "entry.json"), "utf8");
  assert.equal(persistedEntry.includes(secretSentinel), false);
  assert.equal(
    (await Promise.all((await readdir(path.join(repositoryCacheRoot, evidenceKey))).map((name) =>
      readFile(path.join(repositoryCacheRoot, evidenceKey, name), "utf8")))).join("\n")
      .includes(secretSentinel),
    false,
  );
  assert.equal(existsSync(path.join(repositoryCacheRoot, evidenceKey, "mutation-report.html")), false);
  assert.equal(persistedEntry.includes("DATABASE_URL"), false);
  assert.equal(
    (await readdir(repositoryCacheRoot)).some((name) => name.endsWith(".temporary")),
    false,
  );

  const victim = path.join(cacheFixture, "victim");
  await mkdir(victim);
  await writeFile(path.join(victim, "preserve.txt"), "preserve\n");
  const symlinkedCacheParent = path.join(cacheFixture, "symlinked-common", "ledger-mutation-cache");
  await mkdir(path.dirname(symlinkedCacheParent), { recursive: true });
  await symlink(victim, symlinkedCacheParent);
  assert.throws(() => writeSuccessfulCacheEntry({
    root: path.join(symlinkedCacheParent, "v2"),
    evidenceKey: sha256("symlink-root"),
    entry: { result: "passed", shardKind: "stryker" },
    artifacts: { "mutation-report.json": reportSource },
    artifactProjectors: mutationArtifactProjectors,
  }), /unvalidated cache path|symlink/i);
  assert.equal(await readFile(path.join(victim, "preserve.txt"), "utf8"), "preserve\n");

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
        artifactProjectors: mutationArtifactProjectors,
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
    },
    artifactProjectors: mutationArtifactProjectors,
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
    const originalEntry = JSON.parse(await readFile(path.join(sourceDirectory, "entry.json"), "utf8"));
    for (const artifactName of Object.keys(originalEntry.artifacts)) {
      await writeFile(
        path.join(cloneDirectory, artifactName),
        await readFile(path.join(sourceDirectory, artifactName)),
      );
    }
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
  await rm(path.join(partial.cloneDirectory, "mutation-report.json"));
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
  rejectedEntries.push([symlinkedArtifactParent.cloneKey, "artifact-manifest-invalid"]);
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
  const unknownArtifact = await cloneEntry("unknown-artifact-read", (entry) => ({
    ...entry,
    artifacts: {
      ...entry.artifacts,
      "unknown.json": sha256("{}\n"),
    },
  }));
  await writeFile(path.join(unknownArtifact.cloneDirectory, "unknown.json"), "{}\n");
  rejectedEntries.push([unknownArtifact.cloneKey, "artifact-manifest-invalid"]);
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
    `Mutation cache: ${repositoryCacheRoot}\nEntries: 15\n`,
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
  assert.equal(cleared.count, 15);
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
  classification: "scored",
}, invalidDecisionClock);
for (const [decision, details] of [
  ["executed", {}],
  ["executed", { result: "passed", rejectionReason: "not-allowed" }],
  ["executed", { result: "passed", durationMs: 999 }],
  ["executed", { classification: "vitest", result: "passed" }],
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
    classification: "scored",
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
      classification: "scored",
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
  classification: "scored",
}, coldClock);
assert.equal(coldFirst, "cold-core-token");
finishShard(coldRun, coldFirst, "executed", { result: "passed" }, coldClock);
const coldSecond = startShard(coldRun, {
  id: "db",
  evidenceKey: "evidence-db",
  classification: "scored",
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
  classification: "scored",
}, warmClock);
finishShard(warmRun, warmFirst, "reused", { priorDurationMs: 40, result: "passed" }, warmClock);
const warmSecond = startShard(warmRun, {
  id: "db",
  evidenceKey: "evidence-db",
  classification: "scored",
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
    classification: "scored",
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
    classification: "pending",
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
    classification: "pending",
  });
  finishPerformanceRun(failedRun, "failed");
  assert.equal(failedRun.shards[0].status, "started");
  assert.deepEqual(
    JSON.parse(await readFile(writePerformanceRecord(performanceFixture, failedRun), "utf8")),
    failedRun,
  );

  const rollbackRun = createPerformanceRun({
    provenance,
    cacheMode: "enabled",
    machine,
    now: sequenceClock(3_000, 3_010, 3_030, 3_040),
    wallNow: sequenceValue("2026-08-12T12:06:00.000Z", "2026-08-12T12:05:59.000Z"),
    createRunId: sequenceValue("rollback-run", "rollback-write"),
    createShardToken: sequenceValue("rollback-shard-token"),
  });
  const rollbackToken = startShard(rollbackRun, {
    id: "rollback-shard",
    evidenceKey: "rollback-evidence",
    classification: "scored",
  });
  finishShard(rollbackRun, rollbackToken, "executed", { result: "passed" });
  finishPerformanceRun(rollbackRun, "passed");
  assert.equal(rollbackRun.startedAt, "2026-08-12T12:06:00.000Z");
  assert.equal(rollbackRun.finishedAt, "2026-08-12T12:05:59.000Z");
  assert.equal(rollbackRun.wallClockDurationMs, 40);
  assert.deepEqual(
    JSON.parse(await readFile(writePerformanceRecord(performanceFixture, rollbackRun), "utf8")),
    rollbackRun,
  );
  const rollbackSummary = renderBenchmarkSummary(rollbackRun, rollbackRun);
  assert.match(rollbackSummary, /Comparable: yes/);
  assert.match(rollbackSummary, /Wall-clock duration \(ms\) \| 40 \| 40/);
  assert.match(rollbackSummary, /Measured wall-clock savings \(ms\) \| 0/);

  const collisionLeft = {
    ...warmRun,
    shards: warmRun.shards.map((shard, index) => index === 0
      ? { ...shard, id: "collision\0left", evidenceKey: "middle" }
      : { ...shard }),
  };
  const collisionRight = {
    ...warmRun,
    shards: warmRun.shards.map((shard, index) => index === 0
      ? { ...shard, id: "collision", evidenceKey: "left\0middle" }
      : { ...shard }),
  };
  assert.throws(
    () => renderBenchmarkSummary(collisionLeft, collisionRight),
    (error) => /different workloads/.test(error.message),
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
    classification: "scored",
  });
  finishShard(overflowRun, overflowOne, "reused", {
    result: "passed",
    priorDurationMs: Number.MAX_VALUE,
  });
  const overflowTwo = startShard(overflowRun, {
    id: "overflow-two",
    evidenceKey: "overflow-evidence-two",
    classification: "scored",
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
