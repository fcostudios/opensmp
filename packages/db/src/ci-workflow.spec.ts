import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, test } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const workflowPath = resolve(repositoryRoot, ".github/workflows/ci.yml");
const integrationTestPath = resolve(
  repositoryRoot,
  "packages/db/src/migration-release.integration.test.ts",
);

describe("database CI workflow", () => {
  test("is valid YAML with immutable actions and least permissions", async () => {
    const source = await readFile(workflowPath, "utf8");
    const workflow = parse(source) as {
      permissions: Record<string, string>;
      jobs: Record<string, { steps: Array<{ uses?: string }> }>;
    };
    expect(workflow.permissions).toEqual({ contents: "read" });
    const uses = Object.values(workflow.jobs).flatMap((job) =>
      job.steps.flatMap((step) => (step.uses ? [step.uses] : [])),
    );
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) {
      expect(action).toMatch(/^[^@]+@[0-9a-f]{40}$/);
    }
  });

  test("runs every root and committed-migration gate against PostgreSQL 16 roles", async () => {
    const source = await readFile(workflowPath, "utf8");
    expect(source).toContain("postgres:16");
    for (const command of [
      "pnpm install --frozen-lockfile",
      "pnpm type-check",
      "pnpm lint",
      "pnpm test",
      "pnpm build",
      "pnpm validate:routes",
      "pnpm validate:sidebar",
      "pnpm --filter @smp/db db:migrate",
      "pnpm --filter @smp/db db:verify",
      "pnpm --filter @smp/db db:parity",
    ]) {
      expect(source).toContain(command);
    }
    expect(source).toContain("ledger_owner");
    expect(source).toContain("ledger_app");
    expect(source).toContain("DATABASE_ADMIN_URL");
    expect(source).toContain("DATABASE_URL");
    expect(source).toContain("--file=packages/db/scripts/ci-bootstrap.sql");
    expect(source).not.toMatch(/--command=.*CREATE ROLE/);
    expect(source).not.toContain("public.company");
    expect(source).not.toMatch(/uses:\s*[^\n]+@(v\d+|main|master)\b/);
  });

  test("runs real subprocess-tree portability tests on Windows and POSIX", async () => {
    const source = await readFile(workflowPath, "utf8");
    const workflow = parse(source) as {
      permissions: Record<string, string>;
      jobs: Record<
        string,
        {
          permissions?: Record<string, string>;
          strategy?: { matrix?: { os?: string[] } };
          steps: Array<{ run?: string; uses?: string }>;
        }
      >;
    };
    const job = workflow.jobs["process-portability"];
    expect(job).toBeDefined();
    expect(job?.permissions ?? workflow.permissions).toEqual({
      contents: "read",
    });
    expect(job?.strategy?.matrix?.os).toEqual([
      "ubuntu-latest",
      "windows-latest",
    ]);
    expect(job?.steps.some((step) =>
      step.run?.includes("vitest run src/parity-process.spec.ts"),
    )).toBe(true);
    for (const action of job?.steps.flatMap((step) =>
      step.uses ? [step.uses] : [],
    ) ?? []) {
      expect(action).toMatch(/^[^@]+@[0-9a-f]{40}$/);
    }
  });

  test("database integration tests never connect to a caller-supplied cluster", async () => {
    const source = await readFile(integrationTestPath, "utf8");
    expect(source).not.toContain("TEST_POSTGRES_URL");
    expect(source).toContain(
      'new PostgreSqlContainer("postgres:16-alpine")',
    );
  });
});
