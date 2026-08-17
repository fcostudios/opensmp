import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
// Paths are relative to apps/web (not the workspace root): `pnpm --filter
// smp-web exec` always runs its command with cwd set to apps/web regardless
// of the spawning process's own cwd, and the default apps/web/vitest.config.ts
// resolves its `include` globs (and CLI filter arguments) from that same
// cwd. A workspace-root-relative path like
// "apps/web/src/modules/alerts/actions.test.ts" does not match under that
// config -- verified empirically: it resolves to zero test files ("No test
// files found, exiting with code 0"), which would make every mutant appear
// to "survive" a suite that never actually ran. The US-042 probe's
// workspace-root-relative paths only work because it passes
// `--config vitest.us042-surfaces.config.ts`, a config that sets `root` to
// the workspace root explicitly; this probe intentionally uses the default
// config (per the brief), so its paths must be apps/web-relative instead.
const testArgs = [
  "--filter",
  "smp-web",
  "exec",
  "vitest",
  "run",
  "src/modules/alerts/repository.integration.test.ts",
  "src/modules/alerts/ack-alert-policy.test.ts",
  "src/modules/alerts/actions.test.ts",
  "src/components/alerts/alert-page-boundaries.test.ts",
];

const mutants = [
  {
    name: "acknowledgeEvent conditional UPDATE guard removed",
    source: "apps/web/src/modules/alerts/repository.ts",
    search: "WHERE id = $1::uuid AND acknowledged_at IS NULL",
    replacement: "WHERE id = $1::uuid",
  },
  {
    name: "acknowledgeEvent scope-check-before-write ordering removed",
    source: "apps/web/src/modules/alerts/repository.ts",
    search: "scoped.rows.length === 0",
    replacement: "scoped.rows.length === -1",
  },
  {
    name: "acknowledgeEvent audit_log company_id attribution wrong",
    source: "apps/web/src/modules/alerts/repository.ts",
    search: "event.id, rule.company_id,",
    replacement: "event.id, '00000000-0000-4000-8000-000000009999'::uuid,",
  },
  {
    name: "ackAlertPolicy forbidden-before-repository-call ordering removed",
    source: "apps/web/src/modules/alerts/ack-alert-policy.ts",
    search: 'authorization.globalRole !== "group_admin"',
    replacement: "false",
  },
  {
    name: "ackAlertPolicy schema validation removed",
    source: "apps/web/src/modules/alerts/ack-alert-policy.ts",
    search: 'if (!parsed.success) return { ok: false, error: "invalid" };',
    replacement: "",
  },
  {
    name: "ackAlertPolicy not_found mapping removed",
    source: "apps/web/src/modules/alerts/ack-alert-policy.ts",
    search:
      'if (result.status === "not_found") return { ok: false, error: "not_found" };',
    replacement: "",
  },
] as const;

async function runTests(stdio: "ignore" | "inherit"): Promise<number> {
  const child = spawn("pnpm", testArgs, {
    cwd: workspaceRoot,
    env: process.env,
    stdio,
  });
  const [code, signal] = (await once(child, "exit")) as [
    number | null,
    NodeJS.Signals | null,
  ];
  if (signal) throw new Error(`US-043 ack mutation probe ended by ${signal}`);
  return code ?? 1;
}

async function run(): Promise<void> {
  const originals = new Map<string, string>();
  for (const mutant of mutants) {
    if (!originals.has(mutant.source)) {
      originals.set(
        mutant.source,
        await readFile(resolve(workspaceRoot, mutant.source), "utf8"),
      );
    }
  }
  if ((await runTests("inherit")) !== 0) {
    throw new Error("US-043 ack mutation probe baseline failed");
  }

  let killed = 0;
  try {
    for (const mutant of mutants) {
      const sourcePath = resolve(workspaceRoot, mutant.source);
      const original = originals.get(mutant.source)!;
      const first = original.indexOf(mutant.search);
      if (first < 0 || original.indexOf(mutant.search, first + 1) >= 0) {
        throw new Error(`US-043 mutant target is not unique: ${mutant.name}`);
      }
      await writeFile(
        sourcePath,
        original.replace(mutant.search, mutant.replacement),
        "utf8",
      );
      const code = await runTests("ignore");
      await writeFile(sourcePath, original, "utf8");
      if (code === 0) {
        throw new Error(`US-043 ack mutation survived: ${mutant.name}`);
      }
      killed += 1;
      console.log(`killed: ${mutant.name}`);
    }
  } finally {
    await Promise.all(
      [...originals].map(([path, original]) =>
        writeFile(resolve(workspaceRoot, path), original, "utf8"),
      ),
    );
  }
  console.log(
    `US-043 alert acknowledgment mutation probe: ${killed}/${mutants.length} killed, 0 survivors, 0 errors`,
  );
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
