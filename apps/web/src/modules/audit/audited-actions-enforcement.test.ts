import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const script = fileURLToPath(
  new URL("../../../../../scripts/check-audited-actions.mjs", import.meta.url),
);
const applicationRoot = fileURLToPath(new URL("../../../", import.meta.url));
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

  test("accepts a local action helper backed by a factory-created audited service", async () => {
    const root = await fixture({
      "src/app/actions.ts": `"use server";
        import { revalidatePath } from "next/cache";
        import { loadCurrentLedgerAuthorization } from "../modules/identity-access/server-authorization";
        import { createCapacityService } from "../modules/capacity-service";
        const service = createCapacityService(db);
        async function execute(input) {
          const authorization = await loadCurrentLedgerAuthorization();
          if (!authorization) throw new Error("forbidden");
          await service.changeCapacity(authorization, input);
          revalidatePath("/capacity");
        }
        export async function save(input) { await execute(input); }`,
      "src/modules/capacity-service.ts": `import { withAudit } from "@/modules/audit/with-audit";
        export function createCapacityService(database) {
          return { async changeCapacity(authorization, input) {
            return await withAudit(database, async (transaction) => ({
              value: input,
              audit: evidence,
            }));
          }};
        }`,
      "src/modules/identity-access/server-authorization.ts":
        `export async function loadCurrentLedgerAuthorization() { return {}; }`,
      "src/modules/audit/with-audit.ts":
        `export function withAudit(...args) { return args; }`,
    });

    await expect(
      execFileAsync(process.execPath, [script, root]),
    ).resolves.toMatchObject({
      stdout: expect.stringContaining("Audited server action enforcement passed"),
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

  test("does not let an unrelated audited method conceal an unaudited factory result", async () => {
    const root = await fixture({
      "src/app/actions.ts": `"use server";
        import { createCapacityService } from "../modules/capacity-service";
        const service = createCapacityService(db);
        export async function unsafeFactoryResult(input) {
          return service.changeCapacity(input);
        }`,
      "src/modules/capacity-service.ts": `import { withAudit } from "@/modules/audit/with-audit";
        export const unrelated = {
          changeCapacity(input) {
            return withAudit(db, async () => ({ value: input, audit }));
          },
        };
        export function createCapacityService(database) {
          return {
            changeCapacity(input) { return database.update(input); },
          };
        }`,
      "src/modules/audit/with-audit.ts":
        `export function withAudit(...args) { return args; }`,
    });

    await expect(
      execFileAsync(process.execPath, [script, root]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("unsafeFactoryResult"),
    });
  });

  test("accepts only an exactly bound authorization-and-audit action factory", async () => {
    const actionSource = (overrides = "") => `"use server";
      import { revalidatePath } from "next/cache";
      import { loadCurrentLedgerAuthorization } from "../modules/identity-access/server-authorization";
      import { createCapacityServerActions } from "../modules/capacity-actions";
      ${overrides}
      const actions = createCapacityServerActions({
        database,
        loadAuthorization: loadCurrentLedgerAuthorization,
        revalidate: revalidatePath,
      });
      export async function addCapacity(input) {
        return actions.addCapacity(input);
      }`;
    const factorySource = ({
      authorizationLoad = "await loadAuthorization()",
      guard = `if (!authorization) throw new Error("forbidden");`,
      operation = "actions.addCapacity",
      operationPrefix = "await ",
      tail = `revalidate("/capacity");`,
    } = {}) => `import { createManageCapacityActions } from "./capacity-operations";
      export function createCapacityServerActions({ database, loadAuthorization, revalidate }) {
        const actions = createManageCapacityActions({ database });
        return { async addCapacity(input) {
          const authorization = ${authorizationLoad};
          ${guard}
          ${operationPrefix}${operation}(authorization, input);
          ${tail}
        }};
      }`;
    const auditedOperations = `import { createCapacityService } from "./capacity-service";
      export function createManageCapacityActions({ database }) {
        const service = createCapacityService(database);
        return {
          async addCapacity(authorization, input) {
            await service.changeCapacity(authorization, input);
          },
          async registerPurchase(authorization, input) {
            await service.changeCapacity(authorization, input);
          },
        };
      }`;
    const shared = {
      "src/modules/capacity-service.ts": `import { withAudit } from "@/modules/audit/with-audit";
        export function createCapacityService(database) {
          return { async changeCapacity(authorization, input) {
            return withAudit(database, async () => ({ value: input, audit: evidence }));
          }};
        }`,
      "src/modules/identity-access/server-authorization.ts":
        `export async function loadCurrentLedgerAuthorization() { return {}; }`,
      "src/decoy/identity-access/server-authorization.ts":
        `export async function loadCurrentLedgerAuthorization() { return {}; }`,
      "src/modules/audit/with-audit.ts":
        `export function withAudit(...args) { return args; }`,
    };
    const valid = await fixture({
      ...shared,
      "src/app/actions.ts": actionSource(),
      "src/modules/capacity-actions.ts": factorySource(),
      "src/modules/capacity-operations.ts": auditedOperations,
    });
    await expect(
      execFileAsync(process.execPath, [script, valid]),
    ).resolves.toMatchObject({
      stdout: expect.stringContaining("Audited server action enforcement passed"),
    });

    const adversarial = [
      {
        name: "wrong authorization loader",
        actions: actionSource(`const untrustedAuthorization = async () => ({});`).replace(
          "loadAuthorization: loadCurrentLedgerAuthorization",
          "loadAuthorization: untrustedAuthorization",
        ),
        factory: factorySource(),
        operations: auditedOperations,
      },
      {
        name: "same-suffix authorization decoy",
        actions: actionSource().replace(
          'from "../modules/identity-access/server-authorization"',
          'from "../decoy/identity-access/server-authorization"',
        ),
        factory: factorySource(),
        operations: auditedOperations,
      },
      {
        name: "missing authorization await",
        actions: actionSource(),
        factory: factorySource({ authorizationLoad: "loadAuthorization()" }),
        operations: auditedOperations,
      },
      {
        name: "missing authorization guard",
        actions: actionSource(),
        factory: factorySource({ guard: "" }),
        operations: auditedOperations,
      },
      {
        name: "mismatched operation",
        actions: actionSource(),
        factory: factorySource({ operation: "actions.registerPurchase" }),
        operations: auditedOperations,
      },
      {
        name: "computed operation",
        actions: actionSource(),
        factory: factorySource({ operation: 'actions["addCapacity"]' }),
        operations: auditedOperations,
      },
      {
        name: "missing operation await",
        actions: actionSource(),
        factory: factorySource({ operationPrefix: "" }),
        operations: auditedOperations,
      },
      {
        name: "unaudited operations factory",
        actions: actionSource(),
        factory: factorySource(),
        operations: auditedOperations.replace(
          "await service.changeCapacity(authorization, input);",
          "await database.update(input);",
        ),
      },
      {
        name: "wrong revalidator",
        actions: actionSource(`const unsafeRevalidate = (path) => database.update(path);`).replace(
          "revalidate: revalidatePath",
          "revalidate: unsafeRevalidate",
        ),
        factory: factorySource(),
        operations: auditedOperations,
      },
      {
        name: "post-audit mutation",
        actions: actionSource(),
        factory: factorySource({
          tail: `revalidate("/capacity"); await database.update(input);`,
        }),
        operations: auditedOperations,
      },
    ];
    for (const candidate of adversarial) {
      const root = await fixture({
        ...shared,
        "src/app/actions.ts": candidate.actions,
        "src/modules/capacity-actions.ts": candidate.factory,
        "src/modules/capacity-operations.ts": candidate.operations,
      });
      await expect(
        execFileAsync(process.execPath, [script, root]),
        candidate.name,
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("addCapacity"),
      });
    }
  });

  test("traces state-returning actions through authorization and an audited operation factory", async () => {
    const actionSource = `"use server";
      import { revalidatePath } from "next/cache";
      import { loadCurrentLedgerAuthorization } from "../modules/identity-access/server-authorization";
      import { createVendorAccountServerActions } from "../modules/vendor-actions";
      const actions = createVendorAccountServerActions({
        database,
        loadAuthorization: loadCurrentLedgerAuthorization,
        revalidate: revalidatePath,
      });
      export async function createVendorAccount(previousState, formData) {
        return actions.createVendorAccount(previousState, formData);
      }`;
    const factorySource = `import { createManageVendorAccountActions, vendorAccountActionError } from "./vendor-operations";
      export function createVendorAccountServerActions({ database, loadAuthorization, revalidate }) {
        const actions = createManageVendorAccountActions({ database });
        return { async createVendorAccount(previousState, input) {
          void previousState;
          let authorization;
          try { authorization = await loadAuthorization(); }
          catch { return { status: "error", code: "unexpected" }; }
          if (!authorization) return { status: "error", code: "forbidden" };
          let created;
          try { created = await actions.createVendorAccount(authorization, input); }
          catch (error) { return vendorAccountActionError(error); }
          revalidate("/accounts");
          return { status: "success", id: created.id };
        }};
      }`;
    const auditedOperations = `import { createVendorAccountService } from "./vendor-service";
      export function vendorAccountActionError(error) {
        return { status: "error", code: "unexpected" };
      }
      export function createManageVendorAccountActions({ database }) {
        const service = createVendorAccountService(database);
        return { async createVendorAccount(authorization, input) {
          return service.createVendorAccount(authorization, input);
        }};
      }`;
    const shared = {
      "src/app/actions.ts": actionSource,
      "src/modules/vendor-actions.ts": factorySource,
      "src/modules/vendor-service.ts": `import { withAudit } from "@/modules/audit/with-audit";
        function reject(error) { throw new Error(error); }
        function mapPersistenceFailure(error) { reject(error); }
        export function createVendorAccountService(database) {
          const now = () => new Date();
          return { async createVendorAccount(authorization, input) {
            const occurredAt = now();
            try {
              return await withAudit(database, async () => ({ value: input, audit: evidence }));
            } catch (error) {
              mapPersistenceFailure(error);
            }
          }};
        }`,
      "src/modules/identity-access/server-authorization.ts":
        `export async function loadCurrentLedgerAuthorization() { return {}; }`,
      "src/modules/audit/with-audit.ts":
        `export function withAudit(...args) { return args; }`,
    };
    const valid = await fixture({
      ...shared,
      "src/modules/vendor-operations.ts": auditedOperations,
    });
    await expect(execFileAsync(process.execPath, [script, valid])).resolves.toMatchObject({
      stdout: expect.stringContaining("Audited server action enforcement passed"),
    });

    const unaudited = await fixture({
      ...shared,
      "src/modules/vendor-operations.ts": auditedOperations.replace(
        "return service.createVendorAccount(authorization, input);",
        "return database.insert(input);",
      ),
    });
    await expect(execFileAsync(process.execPath, [script, unaudited])).rejects.toMatchObject({
      stderr: expect.stringContaining("createVendorAccount"),
    });

    const externalResultAssignment = await fixture({
      ...shared,
      "src/modules/vendor-actions.ts": factorySource.replace(
        "created = await actions.createVendorAccount(authorization, input);",
        "external.result = await actions.createVendorAccount(authorization, input);",
      ),
      "src/modules/vendor-operations.ts": auditedOperations,
    });
    await expect(
      execFileAsync(process.execPath, [script, externalResultAssignment]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("createVendorAccount"),
    });

    const mutatingErrorMapper = await fixture({
      ...shared,
      "src/modules/vendor-operations.ts": auditedOperations.replace(
        `return { status: "error", code: "unexpected" };`,
        `const target = external;
        target.lastError = error;
        return { status: "error", code: "unexpected" };`,
      ),
    });
    await expect(
      execFileAsync(process.execPath, [script, mutatingErrorMapper]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("createVendorAccount"),
    });

    const mutatingServiceMapper = await fixture({
      ...shared,
      "src/modules/vendor-service.ts": shared["src/modules/vendor-service.ts"].replace(
        "mapPersistenceFailure(error);",
        "mapPersistenceFailure(database.insert(error));",
      ),
      "src/modules/vendor-operations.ts": auditedOperations,
    });
    await expect(
      execFileAsync(process.execPath, [script, mutatingServiceMapper]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("createVendorAccount"),
    });
  });

  test("the current application tree has no unaudited server action", async () => {
    await expect(
      execFileAsync(process.execPath, [script, applicationRoot]),
    ).resolves.toMatchObject({
      stdout: expect.stringContaining(
        "Audited server action enforcement passed",
      ),
    });
  });
});
