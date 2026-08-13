import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BASE_REF,
  FIXTURE_FILES,
  applyFixture,
  checkFixture,
  fixtureInstructions,
  restoreFixture,
} from "./benchmarks/chg014-representative-fixture.mjs";

assert.equal(BASE_REF, "71086076dd1d2a4659798e026bcf7154ba74e9f2");
assert.deepEqual(
  FIXTURE_FILES.map(({ path: relativePath, preSha256, postSha256 }) => ({
    path: relativePath,
    preSha256,
    postSha256,
  })),
  [
    {
      path: "packages/db/src/schema.ts",
      preSha256: "868a7a83630164a252f83fc9ae777e500300ad086d9486b0336da537b162fe0a",
      postSha256: "d4dea1f15fc04df49cc39d9a487e8518cd79ef560530904dc3f280448df1c4dc",
    },
    {
      path: "packages/contracts/src/capacity.ts",
      preSha256: "5385a51cc9afc577b6691f48816420586ab0fa65360a725d1a76a4eb3cdd7ca3",
      postSha256: "bc7aef14955d702f47be67233139e90f9bf20c667d72a731bb70b29db0d058fa",
    },
  ],
);

const sourceRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureRoot = await mkdtemp(path.join(tmpdir(), "ledger-chg014-fixture-"));

try {
  for (const fixture of FIXTURE_FILES) {
    const source = execFileSync("git", ["show", `${BASE_REF}:${fixture.path}`], {
      cwd: sourceRoot,
    });
    const target = path.join(fixtureRoot, fixture.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, source);
  }

  execFileSync("git", ["init", "--quiet"], { cwd: fixtureRoot });
  execFileSync("git", ["add", "."], { cwd: fixtureRoot });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture base"], {
    cwd: fixtureRoot,
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_AUTHOR_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Fixture",
    },
  });
  const fixtureHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: fixtureRoot,
    encoding: "utf8",
  }).trim();
  const originals = new Map(
    await Promise.all(
      FIXTURE_FILES.map(async (fixture) => [
        fixture.path,
        await readFile(path.join(fixtureRoot, fixture.path)),
      ]),
    ),
  );

  assert.deepEqual(await checkFixture({ root: fixtureRoot, expectedHead: fixtureHead }), {
    head: fixtureHead,
    state: "clean",
  });
  assert.deepEqual(await applyFixture({ root: fixtureRoot, expectedHead: fixtureHead }), {
    head: fixtureHead,
    state: "applied",
  });
  assert.deepEqual(await checkFixture({ root: fixtureRoot, expectedHead: fixtureHead }), {
    head: fixtureHead,
    state: "applied",
  });
  await assert.rejects(
    applyFixture({ root: fixtureRoot, expectedHead: fixtureHead }),
    /must be clean/i,
  );

  const restored = await restoreFixture({ root: fixtureRoot, expectedHead: fixtureHead });
  assert.deepEqual(restored, { head: fixtureHead, state: "clean" });
  assert.deepEqual(await checkFixture({ root: fixtureRoot, expectedHead: fixtureHead }), restored);
  for (const fixture of FIXTURE_FILES) {
    assert.deepEqual(await readFile(path.join(fixtureRoot, fixture.path)), originals.get(fixture.path));
  }
  assert.equal(
    execFileSync("git", ["status", "--porcelain"], { cwd: fixtureRoot, encoding: "utf8" }),
    "",
  );

  await writeFile(path.join(fixtureRoot, FIXTURE_FILES[0].path), "unexpected bytes\n");
  await assert.rejects(
    restoreFixture({ root: fixtureRoot, expectedHead: fixtureHead }),
    /mixed or unknown/i,
  );
  assert.equal(
    await readFile(path.join(fixtureRoot, FIXTURE_FILES[0].path), "utf8"),
    "unexpected bytes\n",
  );

  const instructions = fixtureInstructions();
  assert.match(instructions, /DATABASE_ADMIN_URL/);
  assert.match(instructions, /DATABASE_URL/);
  assert.match(instructions, /mutation:benchmark:summary/);
  assert.equal(instructions.includes("://"), false);
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
