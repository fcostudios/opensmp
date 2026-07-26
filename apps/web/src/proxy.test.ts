import {
  getRedirectUrl,
} from "next/experimental/testing/server";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { describe, expect, test } from "vitest";

import type { LedgerSessionUser } from "@/lib/auth/auth-types";
import { routeAuthorizationResponse } from "./lib/auth/route-guard";

const companyA = "00000000-0000-0000-0000-000000000751";

function viewer(): LedgerSessionUser {
  return {
    id: "viewer",
    idpSubject: "viewer-subject",
    email: "viewer@example.test",
    name: "Viewer",
    globalRole: null,
    companyGrants: [{ companyId: companyA, role: "viewer" }],
    employeeCompanyId: null,
    roles: ["viewer"],
    companyIds: [companyA],
    uiLanguage: null,
  };
}

describe("request-time route authorization", () => {
  test("redirects an unauthenticated protected request to login with only a same-origin callback", () => {
    const response = routeAuthorizationResponse(
      new NextRequest("https://ledger.example/companias"),
      null,
    );

    expect(getRedirectUrl(response)).toBe(
      "https://ledger.example/login?callbackUrl=%2Fcompanias",
    );
  });

  test("redirects an authenticated role or company-scope mismatch to access denied", () => {
    const roleMismatch = routeAuthorizationResponse(
      new NextRequest("https://ledger.example/usuarios"),
      viewer(),
    );
    const companyMismatch = routeAuthorizationResponse(
      new NextRequest(
        "https://ledger.example/companias/00000000-0000-0000-0000-000000000752",
      ),
      viewer(),
    );

    expect(getRedirectUrl(roleMismatch)).toBe(
      "https://ledger.example/acceso-denegado",
    );
    expect(getRedirectUrl(companyMismatch)).toBe(
      "https://ledger.example/acceso-denegado",
    );
  });

  test("allows public routes and an authorized company-scoped route", () => {
    const publicResponse = routeAuthorizationResponse(
      new NextRequest("https://ledger.example/login"),
      null,
    );
    const scopedResponse = routeAuthorizationResponse(
      new NextRequest(`https://ledger.example/companias/${companyA}`),
      viewer(),
    );

    expect(getRedirectUrl(publicResponse)).toBeNull();
    expect(getRedirectUrl(scopedResponse)).toBeNull();
    expect(
      scopedResponse.headers.get(
        "x-middleware-request-x-ledger-pathname",
      ),
    ).toBe(`/companias/${companyA}`);
  });

  test("fails closed for a route absent from the authoritative navigation map", () => {
    const response = routeAuthorizationResponse(
      new NextRequest("https://ledger.example/unregistered-screen"),
      viewer(),
    );

    expect(getRedirectUrl(response)).toBe(
      "https://ledger.example/acceso-denegado",
    );
  });

  test("the Next 16 proxy convention keeps the Auth.js wrapper and static matcher wired", () => {
    const source = readFileSync(new URL("./proxy.ts", import.meta.url), "utf8");

    expect(source).toContain("export const proxy = auth(");
    expect(source).toContain("routeAuthorizationResponse(");
    expect(source).toContain("export const config = {");
    expect(source).toContain(
      "/((?!api|auth|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
    );
  });
});
