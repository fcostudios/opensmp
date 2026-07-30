import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import type { LedgerSessionUser } from "./auth-types";
import { authenticatedRouteRedirect } from "./route-guard";

const companyA = "00000000-0000-0000-0000-000000000851";
const companyB = "00000000-0000-0000-0000-000000000852";

function viewer(): LedgerSessionUser {
  return {
    id: "viewer-layout",
    idpSubject: "viewer-layout-subject",
    email: "viewer-layout@example.test",
    name: "Viewer",
    globalRole: null,
    companyGrants: [{ companyId: companyA, role: "viewer" }],
    employeeCompanyId: null,
    roles: ["viewer"],
    companyIds: [companyA],
    uiLanguage: null,
  };
}

describe("authenticated layout authorization", () => {
  test("redirects no session to login and role/scope mismatches to access denied", () => {
    expect(authenticatedRouteRedirect(null, "/companias")).toBe("/login");
    expect(authenticatedRouteRedirect(viewer(), "/usuarios")).toBe(
      "/acceso-denegado",
    );
    expect(
      authenticatedRouteRedirect(viewer(), `/companias/${companyB}`),
    ).toBe("/acceso-denegado");
    expect(authenticatedRouteRedirect(viewer(), null)).toBe(
      "/acceso-denegado",
    );
  });

  test("makes the business authorization decision after proxy authentication", () => {
    expect(
      authenticatedRouteRedirect(viewer(), "/usuarios"),
    ).toBe("/acceso-denegado");
    expect(
      authenticatedRouteRedirect(
        viewer(),
        `/companias/${companyB}`,
      ),
    ).toBe("/acceso-denegado");
    expect(
      authenticatedRouteRedirect(
        viewer(),
        `/companias/${companyA}`,
      ),
    ).toBeNull();
  });

  test("allows only the viewer's declared company-detail screen", () => {
    expect(
      authenticatedRouteRedirect(viewer(), `/companias/${companyA}`),
    ).toBeNull();
  });

  test("the persistent authenticated layout performs identity admission only", () => {
    const layoutSource = readFileSync(
      new URL("../../app/(authenticated)/layout.tsx", import.meta.url),
      "utf8",
    );

    expect(layoutSource).toContain("await auth()");
    expect(layoutSource).toContain('redirect("/login")');
    expect(layoutSource).not.toContain("x-ledger-pathname");
    expect(layoutSource).not.toContain("dynamicBreadcrumbRepository");
    expect(layoutSource).not.toContain("ApplicationShell");
  });

  test("the authenticated template owns every route-sensitive shell decision", () => {
    const templateSource = readFileSync(
      new URL("../../app/(authenticated)/template.tsx", import.meta.url),
      "utf8",
    );
    const appShellSource = readFileSync(
      new URL("../../components/layout/app-shell.tsx", import.meta.url),
      "utf8",
    );

    expect(templateSource).toContain("await auth()");
    expect(templateSource).toContain('get("x-ledger-pathname")');
    expect(templateSource).toContain("authenticatedRouteRedirect");
    expect(templateSource).toContain("dynamicBreadcrumbRepository.resolve");
    expect(templateSource).toContain("dynamicBreadcrumbLabels=");
    expect(templateSource).toContain("redirect(destination)");
    expect(templateSource).toContain("ApplicationShell");
    expect(templateSource).toContain("pathname={pathname}");
    expect(appShellSource).not.toContain("usePathname");
    expect(appShellSource).toContain("readonly pathname: string");
  });
});
