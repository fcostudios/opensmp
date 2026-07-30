import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const script = resolve(
  process.cwd(),
  "../../scripts/check-audited-actions.mjs",
);
const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((fixture) =>
      rm(fixture, { force: true, recursive: true }),
    ),
  );
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "ledger-audit-actions-"));
  fixtures.push(root);
  await Promise.all(
    Object.entries(files).map(async ([path, source]) => {
      const target = resolve(root, path);
      await mkdir(resolve(target, ".."), { recursive: true });
      await writeFile(target, source);
    }),
  );
  return root;
}

describe("audited server action enforcement", () => {
  test("accepts a read-only annotation and a one-hop audited service", async () => {
    const root = await fixture({
      "src/app/actions.ts": `"use server";
        import { localeService } from "../modules/locale";
        /** @read-only-action */
        export async function ping() { return { ok: true }; }
        export async function updateLocale(input) {
          return localeService.updateLocale(input);
        }`,
      "src/modules/locale.ts": `import { withAudit } from "@/modules/audit/with-audit";
        export const localeService = {
          updateLocale(input) {
            return withAudit(db, async (transaction) => ({
              value: input,
              audit: evidence,
            }));
          },
        };`,
      "src/modules/audit/with-audit.ts":
        `export function withAudit(...args) { return args; }`,
    });

    await expect(
      execFileAsync(process.execPath, [script, root]),
    ).resolves.toMatchObject({
      stdout: expect.stringContaining(
        "Audited server action enforcement passed",
      ),
    });
  });

  test("accepts a trusted redirect after an audited service result", async () => {
    const root = await fixture({
      "src/app/actions.ts": `"use server";
        import { redirect } from "next/navigation";
        import { requestService } from "../modules/request-service";
        export async function confirm(input) {
          const result = await requestService.confirm(input);
          if (result.ok) redirect(\`/requests/\${result.requestId}?tab=assignment\`);
          return result;
        }`,
      "src/modules/request-service.ts": `import { withAudit } from "@/modules/audit/with-audit";
        export const requestService = {
          confirm(input) {
            return withAudit(db, async (transaction) => ({
              value: input,
              audit: evidence,
            }));
          },
        };`,
      "src/modules/audit/with-audit.ts":
        `export function withAudit(...args) { return args; }`,
    });

    await expect(
      execFileAsync(process.execPath, [script, root]),
    ).resolves.toMatchObject({
      stdout: expect.stringContaining(
        "Audited server action enforcement passed",
      ),
    });
  });

  test("rejects a mutation after an audited service result", async () => {
    const root = await fixture({
      "src/app/actions.ts": `"use server";
        import { requestService } from "../modules/request-service";
        export async function unsafeSecondMutation(input) {
          const result = await requestService.confirm(input);
          await database.update(result);
          return result;
        }`,
      "src/modules/request-service.ts": `import { withAudit } from "@/modules/audit/with-audit";
        export const requestService = {
          confirm(input) {
            return withAudit(db, async (transaction) => ({
              value: input,
              audit: evidence,
            }));
          },
        };`,
      "src/modules/audit/with-audit.ts":
        `export function withAudit(...args) { return args; }`,
    });

    await expect(
      execFileAsync(process.execPath, [script, root]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("unsafeSecondMutation"),
    });
  });

  test("accepts an aliased import from the real audit boundary", async () => {
    const root = await fixture({
      "src/app/actions.ts": `"use server";
        import { withAudit as audited } from "@/modules/audit/with-audit";
        export async function safeUpdate(input) {
          return audited(db, async () => ({ value: input, audit }));
        }`,
      "src/modules/audit/with-audit.ts":
        `export function withAudit(...args) { return args; }`,
    });

    await expect(
      execFileAsync(process.execPath, [script, root]),
    ).resolves.toMatchObject({
      stdout: expect.stringContaining(
        "Audited server action enforcement passed",
      ),
    });
  });

  test("rejects an inline server action with no audit boundary", async () => {
    const root = await fixture({
      "src/app/page.tsx": `export default function Page() {
        async function unsafeInline(input) {
          "use server";
          return database.update(input);
        }
        return <form action={unsafeInline} />;
      }`,
    });

    await expect(
      execFileAsync(process.execPath, [script, root]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("unsafeInline"),
    });
  });

  test("rejects a withAudit import from the wrong module", async () => {
    const root = await fixture({
      "src/app/actions.ts": `"use server";
        import { withAudit } from "../fake-audit";
        export async function unsafeFake(input) {
          return withAudit(db, async () => database.update(input));
        }`,
      "src/fake-audit.ts":
        `export function withAudit(...args) { return args; }`,
      "src/modules/audit/with-audit.ts":
        `export function withAudit(...args) { return args; }`,
    });

    await expect(
      execFileAsync(process.execPath, [script, root]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("unsafeFake"),
    });
  });

  test("rejects a local binding that shadows the real audit import", async () => {
    const root = await fixture({
      "src/app/actions.ts": `"use server";
        import { withAudit as audited } from "@/modules/audit/with-audit";
        export async function unsafeShadow(input) {
          const audited = (db, operation) => operation(db);
          return audited(db, async () => database.update(input));
        }`,
      "src/modules/audit/with-audit.ts":
        `export function withAudit(...args) { return args; }`,
    });

    await expect(
      execFileAsync(process.execPath, [script, root]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("unsafeShadow"),
    });
  });

  test("rejects an unreachable audit call", async () => {
    const root = await fixture({
      "src/app/actions.ts": `"use server";
        import { withAudit } from "@/modules/audit/with-audit";
        export async function unsafeReturn(input) {
          return database.update(input);
          withAudit(db, async () => ({ value: input, audit }));
        }
        export async function unsafeFalseBranch(input) {
          if (false) {
            return withAudit(db, async () => ({ value: input, audit }));
          }
          return database.update(input);
        }`,
      "src/modules/audit/with-audit.ts":
        `export function withAudit(...args) { return args; }`,
    });

    await expect(
      execFileAsync(process.execPath, [script, root]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(
        /unsafeReturn[\s\S]*unsafeFalseBranch/,
      ),
    });
  });

  test("rejects conditional and short-circuit audit calls that do not dominate the mutation", async () => {
    const root = await fixture({
      "src/app/actions.ts": `"use server";
        import { withAudit } from "@/modules/audit/with-audit";
        export async function conditionalPath(input) {
          if (input.audited) {
            return withAudit(db, async () => ({ value: input, audit }));
          }
          return database.update(input);
        }
        export async function shortCircuitPath(input) {
          false && withAudit(db, async () => ({ value: input, audit }));
          return database.update(input);
        }
        export async function falseLoopPath(input) {
          while (false) {
            await withAudit(db, async () => ({ value: input, audit }));
          }
          return database.update(input);
        }`,
      "src/modules/audit/with-audit.ts":
        `export function withAudit(...args) { return args; }`,
    });

    await expect(
      execFileAsync(process.execPath, [script, root]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(
        /conditionalPath[\s\S]*shortCircuitPath[\s\S]*falseLoopPath/,
      ),
    });
  });

  test("rejects object array and catch bindings that shadow the audit import", async () => {
    const root = await fixture({
      "src/app/actions.ts": `"use server";
        import { withAudit } from "@/modules/audit/with-audit";
        export async function objectShadow(input) {
          const { boundary: withAudit } = input;
          return withAudit(db, async () => ({ value: input, audit }));
        }
        export async function arrayShadow(input) {
          const [withAudit] = input.boundaries;
          return withAudit(db, async () => ({ value: input, audit }));
        }
        export async function catchShadow(input) {
          try {
            throw input;
          } catch (withAudit) {
            return withAudit(db, async () => ({ value: input, audit }));
          }
        }`,
      "src/modules/audit/with-audit.ts":
        `export function withAudit(...args) { return args; }`,
    });

    await expect(
      execFileAsync(process.execPath, [script, root]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(
        /objectShadow[\s\S]*arrayShadow[\s\S]*catchShadow/,
      ),
    });
  });

  test("rejects an exported mutation with no audit boundary", async () => {
    const root = await fixture({
      "src/app/actions.ts": `"use server";
        export async function unsafeUpdate(input) {
          return database.update(input);
        }
        export const unsafeArrow = async (input) => database.update(input);`,
    });

    await expect(
      execFileAsync(process.execPath, [script, root]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/unsafeUpdate[\s\S]*unsafeArrow/),
    });
  });

  test("does not let one audited service method conceal an unaudited sibling", async () => {
    const root = await fixture({
      "src/app/actions.ts": `"use server";
        import { service } from "../modules/service";
        export async function unsafeSibling(input) {
          return service.readThenMutate(input);
        }`,
      "src/modules/service.ts": `import { withAudit } from "@/modules/audit/with-audit";
        export const service = {
          safe(input) {
            return withAudit(db, async () => ({ value: input, audit }));
          },
          readThenMutate(input) {
            return database.update(input);
          },
        };`,
      "src/modules/audit/with-audit.ts":
        `export function withAudit(...args) { return args; }`,
    });

    await expect(
      execFileAsync(process.execPath, [script, root]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("unsafeSibling"),
    });
  });

  test("the current application tree has no unaudited server action", async () => {
    await expect(
      execFileAsync(process.execPath, [script, process.cwd()]),
    ).resolves.toMatchObject({
      stdout: expect.stringContaining(
        "Audited server action enforcement passed",
      ),
    });
  });
});
