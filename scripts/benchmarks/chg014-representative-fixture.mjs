import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const BASE_REF = "c1575cd9d5cc557121d50dc870dc2d30585af112";

function transformSchema(source) {
  const before = 'export const capacityRecoveryWork = pgTable("capacity_recovery_work", {';
  const after = [
    "// CHG-014 representative DB-backed static-schema fixture.",
    'export const capacityRecoveryWork = pgTable(["capacity", "recovery", "work"].join("_"), {',
  ].join("\n");
  const text = source.toString("utf8");
  if (text.split(before).length !== 2) throw new Error("Unexpected schema fixture source");
  return Buffer.from(text.replace(before, after));
}

function transformCapacity(source) {
  const text = source.toString("utf8");
  if (text.includes("\r\n") || !text.includes("\n")) {
    throw new Error("Unexpected capacity fixture line endings");
  }
  return Buffer.from(text.replaceAll("\n", "\r\n"));
}

export const FIXTURE_FILES = Object.freeze([
  Object.freeze({
    path: "packages/db/src/schema.ts",
    preSha256: "868a7a83630164a252f83fc9ae777e500300ad086d9486b0336da537b162fe0a",
    postSha256: "d4dea1f15fc04df49cc39d9a487e8518cd79ef560530904dc3f280448df1c4dc",
    transform: transformSchema,
  }),
  Object.freeze({
    path: "packages/contracts/src/capacity.ts",
    preSha256: "5385a51cc9afc577b6691f48816420586ab0fa65360a725d1a76a4eb3cdd7ca3",
    postSha256: "bc7aef14955d702f47be67233139e90f9bf20c667d72a731bb70b29db0d058fa",
    transform: transformCapacity,
  }),
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function git(root, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    encoding: args[0] === "show" ? "buffer" : "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

async function assertHead(root, expectedHead) {
  const head = String(await git(root, ["rev-parse", "HEAD"])).trim();
  if (head !== expectedHead) {
    throw new Error(`Expected HEAD ${expectedHead}, received ${head}`);
  }
  return head;
}

async function fixtureHashes(root) {
  return Promise.all(
    FIXTURE_FILES.map(async (fixture) => sha256(await readFile(path.join(root, fixture.path)))),
  );
}

function classifyHashes(hashes) {
  if (hashes.every((hash, index) => hash === FIXTURE_FILES[index].preSha256)) return "clean";
  if (hashes.every((hash, index) => hash === FIXTURE_FILES[index].postSha256)) return "applied";
  throw new Error("Fixture is in a mixed or unknown byte state");
}

async function assertRepositoryState(root, state) {
  const status = String(await git(root, ["status", "--porcelain", "--untracked-files=all"]));
  if (state === "clean" && status !== "") {
    throw new Error("Fixture bytes match clean state, but repository must be clean");
  }
  if (state === "applied") {
    const expected = FIXTURE_FILES.map((fixture) => ` M ${fixture.path}`).sort();
    const actual = status.trimEnd().split("\n").filter(Boolean).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error("Applied fixture must be the repository's only changes");
    }
  }
}

export async function checkFixture({ root = process.cwd(), expectedHead = BASE_REF } = {}) {
  const resolvedRoot = path.resolve(root);
  const head = await assertHead(resolvedRoot, expectedHead);
  const state = classifyHashes(await fixtureHashes(resolvedRoot));
  await assertRepositoryState(resolvedRoot, state);
  return { head, state };
}

export async function applyFixture({ root = process.cwd(), expectedHead = BASE_REF } = {}) {
  const resolvedRoot = path.resolve(root);
  const current = await checkFixture({ root: resolvedRoot, expectedHead });
  if (current.state !== "clean") throw new Error("Repository must be clean before fixture apply");

  const transformed = await Promise.all(
    FIXTURE_FILES.map(async (fixture) => {
      const bytes = fixture.transform(await readFile(path.join(resolvedRoot, fixture.path)));
      if (sha256(bytes) !== fixture.postSha256) {
        throw new Error(`Post-fixture hash mismatch for ${fixture.path}`);
      }
      return bytes;
    }),
  );
  await Promise.all(
    FIXTURE_FILES.map((fixture, index) =>
      writeFile(path.join(resolvedRoot, fixture.path), transformed[index]),
    ),
  );
  return checkFixture({ root: resolvedRoot, expectedHead });
}

export async function restoreFixture({ root = process.cwd(), expectedHead = BASE_REF } = {}) {
  const resolvedRoot = path.resolve(root);
  const current = await checkFixture({ root: resolvedRoot, expectedHead });
  if (current.state !== "applied") throw new Error("Fixture is not applied");

  const originals = await Promise.all(
    FIXTURE_FILES.map(async (fixture) => {
      const bytes = await git(resolvedRoot, ["show", `${expectedHead}:${fixture.path}`]);
      if (sha256(bytes) !== fixture.preSha256) {
        throw new Error(`Pre-fixture hash mismatch for ${fixture.path}`);
      }
      return bytes;
    }),
  );
  await Promise.all(
    FIXTURE_FILES.map((fixture, index) =>
      writeFile(path.join(resolvedRoot, fixture.path), originals[index]),
    ),
  );
  return checkFixture({ root: resolvedRoot, expectedHead });
}

export function fixtureInstructions() {
  return [
    `Fixture base: ${BASE_REF}`,
    "Required preconfigured inputs: DATABASE_ADMIN_URL for ledger_owner and DATABASE_URL for ledger_app.",
    "rtk sh -c 'test -n \"${DATABASE_ADMIN_URL:-}\" && test -n \"${DATABASE_URL:-}\"'",
    "rtk pnpm --dir packages/db db:migrate",
    "rtk pnpm --dir packages/db db:verify",
    "rtk pnpm mutation:cache:clear",
    `MUTATION_BASE=${BASE_REF} rtk pnpm test:mutation`,
    `MUTATION_BASE=${BASE_REF} rtk pnpm test:mutation`,
    "rtk pnpm mutation:benchmark:summary <cold-record.json> <warm-record.json>",
  ].join("\n");
}

async function runCli(argv) {
  const command = argv[0];
  const rootIndex = argv.indexOf("--root");
  const root = rootIndex === -1 ? process.cwd() : argv[rootIndex + 1];
  const positional = argv
    .slice(1)
    .filter(
      (_, index) => rootIndex === -1 || (index + 1 !== rootIndex && index + 1 !== rootIndex + 1),
    );
  const expectedState = positional[0];
  if (
    (rootIndex !== -1 && !root)
    || positional.length > 1
    || (rootIndex !== -1 && argv.length !== positional.length + 3)
  ) {
    throw new Error("Usage: <apply|check|restore|instructions> [clean|applied] [--root PATH]");
  }
  if (command === "instructions") {
    if (expectedState !== undefined || rootIndex !== -1) {
      throw new Error("instructions takes no arguments");
    }
    process.stdout.write(`${fixtureInstructions()}\n`);
    return;
  }
  const action = command === "apply"
    ? applyFixture
    : command === "check"
      ? checkFixture
      : command === "restore"
        ? restoreFixture
        : undefined;
  if (
    !action
    || (expectedState !== undefined && expectedState !== "clean" && expectedState !== "applied")
  ) {
    throw new Error("Usage: <apply|check|restore|instructions> [clean|applied] [--root PATH]");
  }
  const result = await action({ root });
  if (expectedState !== undefined && result.state !== expectedState) {
    throw new Error(`Expected fixture state ${expectedState}, received ${result.state}`);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
