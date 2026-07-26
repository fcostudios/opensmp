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

  test("the authenticated layout wires Auth.js and the proxy pathname into the secure decision", () => {
    const source = readFileSync(
      new URL("../../app/(authenticated)/layout.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("await auth()");
    expect(source).toContain('get("x-ledger-pathname")');
    expect(source).toContain("authenticatedRouteRedirect");
    expect(source).toContain("dynamicBreadcrumbRepository.resolve");
    expect(source).toContain("dynamicBreadcrumbLabels=");
    expect(source).toContain("redirect(destination)");
  });
});
