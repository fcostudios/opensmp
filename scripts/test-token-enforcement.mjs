#!/usr/bin/env node
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repo = process.cwd();
const node = process.execPath;
const failures = [];

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "smp-token-enforcement-"));
  cpSync(join(repo, "apps", "web", "src"), join(root, "apps", "web", "src"), { recursive: true });
  cpSync(join(repo, "packages"), join(root, "packages"), { recursive: true });
  cpSync(join(repo, ".design-system-lint-ignore.json"), join(root, ".design-system-lint-ignore.json"));
  return root;
}

function run(script, root, args = []) {
  return spawnSync(node, [join(repo, "scripts", script), ...args, root], { encoding: "utf8" });
}

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function withFixture(name, verify) {
  const root = makeFixture();
  try {
    verify(root);
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function expectRejected(name, root, script, expectedMessage) {
  const result = run(script, root);
  expect(result.status === 1, `${name}: expected ${script} to reject the mutant, got exit ${result.status}`);
  expect(result.stderr.includes(expectedMessage), `${name}: expected diagnostic ${expectedMessage}`);
}

withFixture("lossless token output", (root) => {
  const result = run("check-hardcoded-color.mjs", root, ["--write-tokens"]);
  expect(result.status === 0, "lossless token output: generator did not complete");
  const artifacts = [
    readFileSync(join(root, "apps", "web", "src", "styles", "tokens.css"), "utf8"),
    readFileSync(join(root, "packages", "design-system", "tokens.css"), "utf8"),
  ];
  for (const declaration of [
    "--color-primary: #e7851a;",
    "--font-sans: \"Barlow\", ui-sans-serif, system-ui, sans-serif;",
    "--spacing-0-5: 4px;",
    "--text-body-default: 16px;",
    "--radius-full: 9999px;",
    "--shadow-lg: 0 12px 28px rgba(61,61,61,0.18);",
    "--breakpoint-xl: 1280px;",
    "--duration-fast: 150ms;",
    "--motion-no-parallax-no-carousels: true;",
  ]) for (const css of artifacts) expect(css.includes(declaration), `lossless token output: missing ${declaration}`);
  const parity = run("check-hardcoded-color.mjs", root);
  expect(parity.status === 0, "lossless token output: generated artifacts are not idempotent");
});

withFixture("normalized token collision", (root) => {
  const path = join(root, "packages", "design-system", "tokens.json");
  const tokens = JSON.parse(readFileSync(path, "utf8"));
  tokens.spacing["0-5"] = "5px";
  writeFileSync(path, `${JSON.stringify(tokens, null, 2)}\n`);
  expectRejected("normalized token collision", root, "check-hardcoded-color.mjs", "normalizes to --spacing-0-5");
});

withFixture("background-color substring", (root) => {
  const path = join(root, "packages", "ui", "src", "atoms", "status-pill.css");
  writeFileSync(path, readFileSync(path, "utf8").replace("color: var(--color-success);", "background-color: var(--color-success);"));
  expectRejected("background-color substring", root, "check-status-pill.mjs", ".status-pill--success must use color");
});

withFixture("duplicate status selector", (root) => {
  const path = join(root, "packages", "ui", "src", "atoms", "status-pill.css");
  writeFileSync(path, `${readFileSync(path, "utf8")}\n.status-pill--success { color: var(--color-pending-text); background: var(--color-success-bg); }\n`);
  expectRejected("duplicate status selector", root, "check-status-pill.mjs", "duplicate required selector");
});

withFixture("extra StatusKind union member", (root) => {
  const path = join(root, "packages", "ui", "src", "atoms", "status-pill.tsx");
  writeFileSync(path, readFileSync(path, "utf8").replace('"neutral";', '"neutral" | "legacy";'));
  expectRejected("extra StatusKind union member", root, "check-status-pill.mjs", "StatusKind must be exactly");
});

withFixture("missing visible dot", (root) => {
  const path = join(root, "packages", "ui", "src", "atoms", "status-pill.css");
  writeFileSync(path, readFileSync(path, "utf8").replace('content: "";', "content: none;"));
  expectRejected("missing visible dot", root, "check-status-pill.mjs", "must render a visible dot");
});

if (failures.length) {
  for (const failure of failures) console.error(`[token-enforcement test] ${failure}`);
  process.exit(1);
}
console.log("[token-enforcement test] ok");
