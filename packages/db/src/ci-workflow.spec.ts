import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, test } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const workflowPath = resolve(repositoryRoot, ".github/workflows/ci.yml");

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
    expect(source).not.toContain("public.company");
    expect(source).not.toMatch(/uses:\s*[^\n]+@(v\d+|main|master)\b/);
  });
});
