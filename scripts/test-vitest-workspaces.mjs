import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { findVitestWorkspaceConfigFailures } from "./check-vitest-workspaces.mjs";

function createFixture(packageName, testScript, configFiles = []) {
  const root = mkdtempSync(join(tmpdir(), "ledger-vitest-workspaces-"));
  const packageDirectory = join(root, "packages", packageName);
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(
    join(root, "pnpm-workspace.yaml"),
    'packages:\n  - "packages/*"\n',
  );
  writeFileSync(
    join(packageDirectory, "package.json"),
    `${JSON.stringify({ scripts: { test: testScript } }, null, 2)}\n`,
  );
  for (const configFile of configFiles) {
    writeFileSync(join(packageDirectory, configFile), "");
  }
  return root;
}

const configuredRoot = createFixture(
  "config",
  "vitest run",
  ["vitest.config.ts"],
);
const missingRoot = createFixture(
  "notifications",
  "vitest run --passWithNoTests",
);
const nonVitestRoot = createFixture("notifications", "node --test");
const duplicateConfigRoot = createFixture(
  "config",
  "vitest run",
  ["vitest.config.ts", "vitest.config.mts"],
);
const directoryConfigRoot = createFixture("notifications", "vitest run");
mkdirSync(
  join(directoryConfigRoot, "packages", "notifications", "vitest.config.ts"),
);

try {
  assert.deepEqual(findVitestWorkspaceConfigFailures(configuredRoot), []);
  assert.deepEqual(
    findVitestWorkspaceConfigFailures(missingRoot),
    [
      "packages/notifications: test script invokes vitest but no vitest.config.* exists",
    ],
  );
  assert.deepEqual(findVitestWorkspaceConfigFailures(nonVitestRoot), []);
  assert.deepEqual(
    findVitestWorkspaceConfigFailures(duplicateConfigRoot),
    [
      "packages/config: test script invokes vitest but 2 vitest.config.* files exist",
    ],
  );
  assert.deepEqual(
    findVitestWorkspaceConfigFailures(directoryConfigRoot),
    [
      "packages/notifications: test script invokes vitest but no vitest.config.* exists",
    ],
  );
} finally {
  rmSync(configuredRoot, { recursive: true, force: true });
  rmSync(missingRoot, { recursive: true, force: true });
  rmSync(nonVitestRoot, { recursive: true, force: true });
  rmSync(duplicateConfigRoot, { recursive: true, force: true });
  rmSync(directoryConfigRoot, { recursive: true, force: true });
}

for (const [name, yaml] of [
  ["inline list", 'packages: ["packages/*"]\n'],
  ["recursive glob", 'packages:\n  - "packages/**"\n'],
  ["empty list", "packages:\n"],
  ["empty pattern", 'packages:\n  - ""\n'],
]) {
  test(`workspace discovery rejects ${name} instead of auditing zero packages`, () => {
    const root = createFixture("notifications", "vitest run");
    try {
      writeFileSync(join(root, "pnpm-workspace.yaml"), yaml);
      assert.throws(() => findVitestWorkspaceConfigFailures(root),
        /pnpm-workspace.yaml: use a non-empty packages block list with literal directory segments or single-star segments/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

for (const command of ['"vitest" run', '"./node_modules/.bin/vitest" run', "'vitest' run", "'./node_modules/.bin/vitest' run"]) {
  test(`quoted executable requires package config: ${command}`, () => {
    const root = createFixture("notifications", command);
    try {
      assert.deepEqual(findVitestWorkspaceConfigFailures(root), [
        "packages/notifications: test script invokes vitest but no vitest.config.* exists",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("substring-only commands are not Vitest executables", () => {
  const root = createFixture("notifications", 'node scripts/vitest-helper.mjs && "not-vitest" run');
  try {
    assert.deepEqual(findVitestWorkspaceConfigFailures(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a symlink to a regular config is not a package-owned config", () => {
  const root = createFixture("notifications", "vitest run");
  try {
    const target = join(root, "shared-vitest.config.ts");
    writeFileSync(target, "");
    symlinkSync(target, join(root, "packages/notifications/vitest.config.ts"));
    assert.deepEqual(findVitestWorkspaceConfigFailures(root), [
      "packages/notifications: test script invokes vitest but no vitest.config.* exists",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
