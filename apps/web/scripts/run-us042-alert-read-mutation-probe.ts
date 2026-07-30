import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const testArgs = [
  "--filter",
  "smp-web",
  "exec",
  "vitest",
  "run",
  "--config",
  "vitest.us042-surfaces.config.ts",
  "apps/web/src/modules/operational-alert-read.integration.test.ts",
  "apps/web/src/modules/alerts/repository.integration.test.ts",
  "apps/web/src/modules/request-workflow/read-repository.integration.test.ts",
  "apps/web/src/components/alerts/alert-page-boundaries.test.ts",
  "apps/web/src/components/exceptions/exception-page-boundaries.test.ts",
];

const mutants = [
  {
    name: "company authorization predicate removed",
    source: "apps/web/src/modules/operational-alert-read.ts",
    search: "AND rule.company_id = ANY($2::uuid[])",
    replacement: "AND rule.company_id IS NOT NULL",
  },
  {
    name: "global events allowed without group admin",
    source: "apps/web/src/modules/operational-alert-read.ts",
    search: "($1::boolean AND rule.scope_kind::text = 'global')",
    replacement: "(TRUE AND rule.scope_kind::text = 'global')",
  },
  {
    name: "active alert filter removed",
    source: "apps/web/src/modules/operational-alert-read.ts",
    search: "AND (NOT $3::boolean OR event.acknowledged_at IS NULL)",
    replacement: "AND TRUE",
  },
  {
    name: "cursor id tie-break removed",
    source: "apps/web/src/modules/operational-alert-read.ts",
    search:
      "OR (event.fired_at, event.id) < ($4::timestamptz, $5::uuid)",
    replacement: "OR event.fired_at < $4::timestamptz",
  },
  {
    name: "bounded limit clamp removed",
    source: "apps/web/src/modules/operational-alert-read.ts",
    search: `const limit = Math.min(
    MAX_ALERT_LIMIT,
    Math.max(1, Math.trunc(options.limit ?? DEFAULT_ALERT_LIMIT)),
  );`,
    replacement: "const limit = 100;",
  },
  {
    name: "pagination lookahead removed",
    source: "apps/web/src/modules/operational-alert-read.ts",
    search: "limit + 1,",
    replacement: "limit - 1,",
  },
  {
    name: "request company attribution removed",
    source: "apps/web/src/modules/operational-alert-read.ts",
    search: `COALESCE(
                  rule.company_id,
                  request_target.company_id
                )::text AS company_id`,
    replacement: "rule.company_id::text AS company_id",
  },
  {
    name: "unresolved request link guard removed",
    source: "apps/web/src/modules/operational-alert-read.ts",
    search: "THEN request_target.company_id IS NOT NULL",
    replacement: "THEN TRUE",
  },
  {
    name: "malformed cursor UUID accepted",
    source: "apps/web/src/modules/operational-alert-read.ts",
    search: "z.string().uuid().safeParse(id).success",
    replacement: "true",
  },
  {
    name: "malformed cursor timestamp accepted",
    source: "apps/web/src/modules/operational-alert-read.ts",
    search: "Number.isFinite(firedAt.getTime()) &&",
    replacement: "true &&",
  },
  {
    name: "alert count company authorization removed",
    source: "apps/web/src/modules/operational-alert-read.ts",
    search: "AND count_rule.company_id = ANY($2::uuid[])",
    replacement: "AND count_rule.company_id IS NOT NULL",
  },
  {
    name: "alert count global authorization removed",
    source: "apps/web/src/modules/operational-alert-read.ts",
    search:
      "($1::boolean AND count_rule.scope_kind::text = 'global')",
    replacement: "(TRUE AND count_rule.scope_kind::text = 'global')",
  },
  {
    name: "alert unacknowledged count status removed",
    source: "apps/web/src/modules/operational-alert-read.ts",
    search: "WHERE count_event.acknowledged_at IS NULL",
    replacement: "WHERE TRUE",
  },
  {
    name: "badge overflow threshold inverted",
    source: "apps/web/src/modules/operational-alert-read.ts",
    search:
      "return count > BigInt(99) ? overflowLabel : count.toString();",
    replacement:
      "return count <= BigInt(99) ? overflowLabel : count.toString();",
  },
  {
    name: "blocked exception count status removed",
    source: "apps/web/src/modules/request-workflow/read-repository.ts",
    search: "WHERE count_request.state = 'blocked_no_seat'",
    replacement: "WHERE count_request.state = 'active'",
  },
  {
    name: "failed exception count status removed",
    source: "apps/web/src/modules/request-workflow/read-repository.ts",
    search:
      "AND count_action.status IN ('failed', 'verification_failed')",
    replacement: "AND count_action.status = 'confirmed'",
  },
  {
    name: "blocked exception count authorization removed",
    source: "apps/web/src/modules/request-workflow/read-repository.ts",
    search:
      'AND ${readScope(authorization, sql.raw("count_request"))}',
    replacement: "AND ${sql`TRUE`}",
  },
  {
    name: "failed exception count authorization removed",
    source: "apps/web/src/modules/request-workflow/read-repository.ts",
    search: `AND \${readScope(
                  authorization,
                  sql.raw("count_failed_request"),
                )}`,
    replacement: "AND ${sql`TRUE`}",
  },
  {
    name: "alert all badge mapped from unacknowledged count",
    source: "apps/web/src/app/(authenticated)/alertas/page.tsx",
    search: "eventCounts.all,",
    replacement: "eventCounts.unacknowledged,",
  },
  {
    name: "blocked badge mapped from failed count",
    source: "apps/web/src/app/(authenticated)/excepciones/page.tsx",
    search: "exceptionCounts.blocked,",
    replacement: "exceptionCounts.failed,",
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
  if (signal) throw new Error(`US-042 alert mutation probe ended by ${signal}`);
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
    throw new Error("US-042 alert mutation probe baseline failed");
  }

  let killed = 0;
  try {
    for (const mutant of mutants) {
      const sourcePath = resolve(workspaceRoot, mutant.source);
      const original = originals.get(mutant.source)!;
      const first = original.indexOf(mutant.search);
      if (first < 0 || original.indexOf(mutant.search, first + 1) >= 0) {
        throw new Error(`US-042 mutant target is not unique: ${mutant.name}`);
      }
      await writeFile(
        sourcePath,
        original.replace(mutant.search, mutant.replacement),
        "utf8",
      );
      const code = await runTests("ignore");
      await writeFile(sourcePath, original, "utf8");
      if (code === 0) {
        throw new Error(`US-042 alert mutation survived: ${mutant.name}`);
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
    `US-042 alert read mutation probe: ${killed}/${mutants.length} killed, 0 survivors, 0 errors`,
  );
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
