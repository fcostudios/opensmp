import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// An explicit inventory makes newly added company-owned tables a failing gate
// until their real query-path oracle is enrolled. No glob can silently skip one.
const root = fileURLToPath(new URL("../", import.meta.url));
const inventory = JSON.parse(readFileSync(new URL("../testing/company-isolation.json", import.meta.url)));
const files = [...new Set(Object.values(inventory.seams).flat())];
const groups = [
  ["@smp/db", "packages/db/", ["src/company-isolation-inventory.spec.ts", "src/ci-workflow.spec.ts"]],
  ["@smp/domain", "packages/domain/", []],
  ["smp-web", "apps/web/", []],
];
for (const [pkg, prefix, extra] of groups) {
  const selected = files.filter(file => file.startsWith(prefix)).map(file => file.slice(prefix.length));
  const result = spawnSync("pnpm", ["--filter", pkg, "exec", "tsx", "../../packages/db/src/testing/run-with-shared-postgres.ts", "vitest", "run", ...extra, ...selected, "--passWithNoTests=false", "--maxWorkers=2"], {
    cwd: root, stdio: "inherit", env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
