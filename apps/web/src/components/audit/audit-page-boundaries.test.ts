import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const routeRoot = resolve(
  process.cwd(),
  "src/app/(authenticated)/auditoria",
);

describe("audit route boundaries", () => {
  test("loading state is announced as status", async () => {
    const source = await readFile(
      resolve(routeRoot, "loading.tsx"),
      "utf8",
    );

    expect(source).toContain('data-testid="audit_loading"');
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-live="polite"');
  });

  test("database errors expose an alert and a real retry action", async () => {
    const source = await readFile(
      resolve(routeRoot, "error.tsx"),
      "utf8",
    );

    expect(source).toContain('data-testid="audit_error"');
    expect(source).toContain('role="alert"');
    expect(source).toContain("onClick={reset}");
  });

  test("page authenticates and queries only through the capability-gated repository", async () => {
    const source = await readFile(
      resolve(routeRoot, "page.tsx"),
      "utf8",
    );

    expect(source).toContain("await auth()");
    expect(source).toContain("auditQueryService.list");
    expect(source).toContain('redirect("/acceso-denegado")');
    expect(source).not.toContain("@smp/db");
    expect(source).not.toContain("<main");
  });
});
