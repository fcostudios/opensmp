#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const sourcePath = resolve("packages/db/src/pool-snapshots.ts");
const testPath = "packages/db/src/pool-snapshots.test.ts";
const evidencePath = process.argv[2];
if (!evidencePath) throw new Error("pool projection evidence path is required");

const source = readFileSync(sourcePath, "utf8");
const replaceExactlyOnce = (contents, before, after, faultId) => {
  if (contents.split(before).length - 1 !== 1) {
    throw new Error(`pool projection fault ${faultId} does not have one exact target`);
  }
  return contents.replace(before, after);
};
const faults = [
  {
    id: "outer-projection-removed-or-renamed",
    source: replaceExactlyOnce(
      source,
      "capacity.effective_from::text AS effective_from",
      "capacity.effective_from::text AS wrong_effective_from",
      "outer-projection-removed-or-renamed",
    ),
  },
  {
    id: "lateral-field-removed",
    source: replaceExactlyOnce(
      source,
      "vac.license_type_id, vac.purchased_qty, vac.effective_from",
      "vac.license_type_id, vac.purchased_qty",
      "lateral-field-removed",
    ),
  },
  {
    id: "row-mapping-wrong",
    source: replaceExactlyOnce(
      source,
      "effectiveFrom: row.effective_from",
      "effectiveFrom: row.contract_renewal_on",
      "row-mapping-wrong",
    ),
  },
  {
    id: "operating-date-input-replaced",
    source: replaceExactlyOnce(
      source,
      "effectiveFrom: row.effective_from",
      "effectiveFrom: input.operatingDate",
      "operating-date-input-replaced",
    ),
  },
  {
    id: "operating-date-constant",
    source: replaceExactlyOnce(
      source,
      "effectiveFrom: row.effective_from",
      'effectiveFrom: "2026-08-04"',
      "operating-date-constant",
    ),
  },
];

const runTest = (implementationPath) => spawnSync(
  "./apps/web/node_modules/.bin/vitest",
  ["run", "--config", "vitest.mutation.config.mjs", testPath],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...(implementationPath
        ? { POOL_SNAPSHOT_IMPLEMENTATION_PATH: implementationPath }
        : {}),
    },
  },
);

const resultEvidence = (result) => {
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const outputHash = createHash("sha256").update(output).digest("hex");
  return {
    observedExitStatus: result.status,
    observedSignal: result.signal,
    outputHash,
    resultHash: createHash("sha256").update(JSON.stringify({
      error: result.error?.message ?? null,
      outputHash,
      signal: result.signal,
      status: result.status,
    })).digest("hex"),
  };
};

const temporaryRoot = mkdtempSync(join(resolve(".tmp"), "pool-projection-"));
try {
  const baseline = runTest();
  const baselineResult = resultEvidence(baseline);
  if (
    baseline.status !== 0 || baseline.signal !== null || baseline.error ||
    !`${baseline.stdout}${baseline.stderr}`.includes("Tests  1 passed")
  ) {
    process.stderr.write(baseline.stdout);
    process.stderr.write(baseline.stderr);
    throw new Error(`pool projection baseline exited ${baseline.status}`);
  }
  const controls = [];
  for (const fault of faults) {
    const variantPath = join(temporaryRoot, `${fault.id}.ts`);
    writeFileSync(variantPath, fault.source, "utf8");
    const result = runTest(variantPath);
    const observed = resultEvidence(result);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    controls.push({
      expectedStatus: "failed",
      faultId: fault.id,
      ...observed,
      observedStatus: result.status === 1 ? "failed" : "invalid-result",
      variantSourceHash: createHash("sha256")
        .update(fault.source)
        .digest("hex"),
    });
    if (
      result.status !== 1 || result.signal !== null || result.error ||
      !output.includes(
        "keeps purchased quantity paired with its effective date across operating dates",
      ) || !output.includes("Tests  1 failed")
    ) {
      throw new Error(`pool projection negative control had an invalid failure: ${fault.id}`);
    }
  }
  const evidence = {
    baseline: {
      expectedStatus: "passed",
      ...baselineResult,
      observedStatus: "passed",
    },
    controls,
    source: "packages/db/src/pool-snapshots.ts",
    sourceHash: createHash("sha256").update(source).digest("hex"),
    test: testPath,
  };
  mkdirSync(dirname(resolve(evidencePath)), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
