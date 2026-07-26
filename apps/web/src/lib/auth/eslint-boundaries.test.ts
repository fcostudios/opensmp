import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, test } from "vitest";

const webRoot = fileURLToPath(new URL("../../..", import.meta.url));
const eslint = new ESLint({
  cwd: webRoot,
  overrideConfigFile: "eslint.config.mjs",
});

async function restrictedImportMessages(
  filePath: string,
): Promise<readonly string[]> {
  const [result] = await eslint.lintText(
    'import { db } from "@smp/db";\nvoid db;\n',
    { filePath },
  );
  return (result?.messages ?? [])
    .filter(({ ruleId }) => ruleId === "no-restricted-imports")
    .map(({ message }) => message);
}

describe("database import boundary", () => {
  test.each([
    "src/app/(authenticated)/companias/page.tsx",
    "src/app/api/companies/route.ts",
    "src/components/layout/example.tsx",
    "src/modules/org-registry/actions/update-company.ts",
    "src/modules/org-registry/service.ts",
    "src/app/actions.ts",
    "src/lib/i18n/request.ts",
  ])("rejects direct @smp/db access from %s", async (filePath) => {
    await expect(restrictedImportMessages(filePath)).resolves.toEqual([
      expect.stringContaining(
        "Company data access belongs in repositories or transaction services",
      ),
    ]);
  });

  test.each([
    "src/lib/auth/database-boundary.test.ts",
    "src/modules/org-registry/repository.ts",
    "src/modules/org-registry/company-transaction.ts",
    "src/app/api/health/route.ts",
    "src/app/api/health/health.ts",
    "src/lib/auth/auth-config.ts",
    "src/modules/identity-access/session.ts",
    "src/modules/identity-access/authorization.ts",
    "src/modules/identity-access/server-authorization.ts",
    "src/modules/identity-access/locale.ts",
    "src/modules/audit/auth-events.ts",
  ])("allows the declared server data boundary %s", async (filePath) => {
    await expect(restrictedImportMessages(filePath)).resolves.toEqual([]);
  });

  test("all current web source files comply with the database boundary", async () => {
    const results = await eslint.lintFiles(["src/**/*.{ts,tsx}"]);
    const violations = results.flatMap((result) =>
      result.messages
        .filter(({ ruleId }) => ruleId === "no-restricted-imports")
        .map(({ message }) => `${result.filePath}: ${message}`),
    );

    expect(violations).toEqual([]);
  });
});
