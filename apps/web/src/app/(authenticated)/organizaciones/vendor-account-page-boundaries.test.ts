import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const routeRoot = resolve(
  process.cwd(),
  "src/app/(authenticated)/organizaciones",
);

async function routeSource(relativePath: string): Promise<string> {
  return readFile(resolve(routeRoot, relativePath), "utf8");
}

describe("vendor-account route boundaries", () => {
  test.each(["page.tsx", "[vendorAccountId]/page.tsx"])(
    "%s authenticates through the canonical loader and redirects unauthorized users",
    async (relativePath) => {
      const source = await routeSource(relativePath);

      expect(source).toContain("await loadCurrentLedgerAuthorization()");
      expect(source).toContain("redirect(ROUTE_SCR_ACCESS_DENIED)");
      expect(source).not.toContain("SCAFFOLD");
      expect(source).not.toContain("data-scaffold");
    },
  );

  test("detail validates the route UUID before constructing or calling repositories", async () => {
    const source = await routeSource("[vendorAccountId]/page.tsx");
    const parseIndex = source.indexOf("parseVendorAccountId(");
    const vendorRepositoryIndex = source.indexOf("getVendorAccountRepository()");
    const poolRepositoryIndex = source.indexOf("getPoolRepository()");

    expect(parseIndex).toBeGreaterThan(-1);
    expect(vendorRepositoryIndex).toBeGreaterThan(parseIndex);
    expect(poolRepositoryIndex).toBeGreaterThan(parseIndex);
  });

  test("loading state is localized and announced as a polite status", async () => {
    const source = await routeSource("loading.tsx");

    expect(source).toContain('getTranslations("vendorAccounts")');
    expect(source).toContain('data-testid="vendor_accounts_loading"');
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('t("loading")');
  });

  test("error state is localized, alerts users, and invokes only the supplied retry", async () => {
    const source = await routeSource("error.tsx");

    expect(source).toContain('useTranslations("vendorAccounts")');
    expect(source).toContain('data-testid="vendor_accounts_error"');
    expect(source).toContain('role="alert"');
    expect(source).toContain('onClick={reset}');
    expect(source).toContain('t("loadError")');
    expect(source).toContain('t("retry")');
    expect(source).not.toMatch(/console\.(?:debug|error|info|log|warn)/);
  });
});
