import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  classifyExactDelegationAdapter,
  classifyExactFrameworkAdapter,
  DIRECT_TEST_ROUTES,
  verificationAuditsForReport,
} from "./mutation-scope.mjs";

const contracts = [
  {
    source: "apps/web/src/components/usage/usage-view.tsx",
    hash: "f32ecc4cf9af547457e32ad1c45886a336acb62719903856d0876ae093e6b334",
    classify: classifyExactDelegationAdapter,
    kind: "delegation",
    replacements: [["propose={propose}", "propose={undefined}"], ["requestId={requestId}", "requestId={() => undefined}"]],
  },
  {
    source: "apps/web/src/app/(authenticated)/uso/page.tsx",
    hash: "8811d58952ee2964a76d812ea3154c2e0ebaae9869b5acfeaa3f96c4cfec0154",
    classify: classifyExactFrameworkAdapter,
    kind: "framework",
    replacements: [["propose={proposeReclamations}", "propose={undefined}"], ["loadCurrentLedgerAuthorization()", "loadOtherAuthorization()"]],
  },
];
for (const { source, hash, classify, kind, replacements } of contracts) {
  const contents = readFileSync(source, "utf8");
  assert.equal(createHash("sha256").update(contents).digest("hex"), hash);
  const range = `${source}:1-1`;
  const audit = classify(source, contents, [range]);
  assert.equal(audit.reason, `verification-only:exact-${kind}-adapter`);
  assert.deepEqual(audit.verifiedMutationRanges, [range]);
  for (const [before, after] of replacements) {
    assert.ok(contents.includes(before));
    assert.throws(() => classify(source, contents.replace(before, after), [range]), new RegExp(`exact ${kind} adapter changed`));
  }
  assert.throws(() => classify(source, contents, [`${source}:0-1`]), /range escapes source/);
  const shard = { id: `US-073-${kind}`, sources: [source], mutate: [range] };
  assert.equal(verificationAuditsForReport({ files: {} }, shard, [])[0].reason, audit.reason);
  assert.throws(() => verificationAuditsForReport({ files: {} }, { ...shard, sources: [source, "packages/db/src/reclamation-proposals.ts"] }, []), /cannot share a verification-only shard/);
  assert.throws(() => verificationAuditsForReport({ files: { [source]: { mutants: [{ status: "Survived" }] } } }, shard, []), /nonzero mutation shard .* cannot downgrade/);
}
assert.deepEqual(DIRECT_TEST_ROUTES[contracts[0].source], ["apps/web/src/app/(authenticated)/uso/page.integration.test.tsx"]);
assert.deepEqual(DIRECT_TEST_ROUTES["apps/web/src/components/usage/usage-batch-table.tsx"], ["apps/web/src/components/usage/usage-view.integration.test.tsx"]);
