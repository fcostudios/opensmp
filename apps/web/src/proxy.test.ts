import {
  getRedirectUrl,
} from "next/experimental/testing/server";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { describe, expect, test } from "vitest";

import { routeAuthenticationResponse } from "./lib/auth/route-guard";

describe("request-time route authorization", () => {
  test("redirects an unauthenticated protected request to login with only a same-origin callback", () => {
    const response = routeAuthenticationResponse(
      new NextRequest("https://ledger.example/companias"),
      false,
    );

    expect(getRedirectUrl(response)).toBe(
      "https://ledger.example/login?callbackUrl=%2Fcompanias",
    );
  });

  test("defers business-role and company decisions to the database-enriched layout", () => {
    const roleSensitive = routeAuthenticationResponse(
      new NextRequest("https://ledger.example/usuarios"),
      true,
    );
    const companySensitive = routeAuthenticationResponse(
      new NextRequest(
        "https://ledger.example/companias/00000000-0000-0000-0000-000000000752",
      ),
      true,
    );

    expect(getRedirectUrl(roleSensitive)).toBeNull();
    expect(getRedirectUrl(companySensitive)).toBeNull();
    expect(
      roleSensitive.headers.get(
        "x-middleware-request-x-ledger-pathname",
      ),
    ).toBe("/usuarios");
    expect(
      companySensitive.headers.get(
        "x-middleware-request-x-ledger-pathname",
      ),
    ).toBe(
      "/companias/00000000-0000-0000-0000-000000000752",
    );
  });

  test("allows public routes and an authorized company-scoped route", () => {
    const publicResponse = routeAuthenticationResponse(
      new NextRequest("https://ledger.example/login"),
      false,
    );
    const scopedResponse = routeAuthenticationResponse(
      new NextRequest(
        "https://ledger.example/companias/00000000-0000-0000-0000-000000000751",
      ),
      true,
    );

    expect(getRedirectUrl(publicResponse)).toBeNull();
    expect(getRedirectUrl(scopedResponse)).toBeNull();
    expect(
      scopedResponse.headers.get(
        "x-middleware-request-x-ledger-pathname",
      ),
    ).toBe(
      "/companias/00000000-0000-0000-0000-000000000751",
    );
  });

  test("fails closed for a route absent from the authoritative navigation map", () => {
    const response = routeAuthenticationResponse(
      new NextRequest("https://ledger.example/unregistered-screen"),
      true,
    );

    expect(getRedirectUrl(response)).toBe(
      "https://ledger.example/acceso-denegado",
    );
  });

  test("the Next 16 proxy convention keeps the Auth.js wrapper and static matcher wired", () => {
    const source = readFileSync(new URL("./proxy.ts", import.meta.url), "utf8");

    expect(source).toContain("export const proxy = auth(");
    expect(source).toContain("routeAuthenticationResponse(");
    expect(source).toContain("export const config = {");
    expect(source).toContain(
      "/((?!api|auth|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
    );
  });
});
