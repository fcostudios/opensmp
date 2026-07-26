import { describe, expect, test } from "vitest";

import { shellRouteContext } from "./breadcrumbs";

describe("shellRouteContext", () => {
  test.each([
    ["/panel", "pages.panel.title"],
    ["/solicitudes", "pages.solicitudes.title"],
    ["/estados-de-cuenta", "pages.estados-de-cuenta.title"],
  ] as const)(
    "derives the page title key for %s from generated route data",
    (pathname, titleKey) => {
      expect(shellRouteContext(pathname)).toEqual({
        titleKey,
        breadcrumbs: [{ titleKey, href: null }],
      });
    },
  );

  test.each([
    [
      "/companias/00000000-0000-0000-0000-000000000651",
      { "company name": "Kickoff" },
      "Kickoff",
    ],
    [
      "/solicitudes/00000000-0000-0000-0000-000000000652",
      { "request short id": "REQ-0142" },
      "REQ-0142",
    ],
    [
      "/organizaciones/00000000-0000-0000-0000-000000000653",
      { "vendor account name": "Claude Enterprise · Central" },
      "Claude Enterprise · Central",
    ],
    [
      "/personas/00000000-0000-0000-0000-000000000654",
      { "person name": "María Fernanda Ríos" },
      "María Fernanda Ríos",
    ],
    [
      "/estados-de-cuenta/00000000-0000-0000-0000-000000000655",
      { "company code": "KCK", period: "2026-07" },
      "KCK · 2026-07",
    ],
  ] as const)(
    "resolves the authoritative dynamic breadcrumb pattern for %s",
    (pathname, labels, currentLabel) => {
      const routeContext = shellRouteContext(pathname, labels);

      expect(routeContext?.breadcrumbs.at(-1)).toEqual({
        label: currentLabel,
        href: null,
      });
      expect(JSON.stringify(routeContext)).not.toMatch(
        /Company details|Request details|Vendor account details|Person details|Statement details/,
      );
    },
  );

  test("derives a linked parent and exact current crumb without exposing the route UUID", () => {
    const companyId = "00000000-0000-0000-0000-000000000651";

    expect(
      shellRouteContext(`/companias/${companyId}`, {
        "company name": "Kickoff",
      }),
    ).toEqual({
      titleKey: "pages.companias/[companyId].title",
      breadcrumbs: [
        { titleKey: "pages.companias.title", href: "/companias" },
        {
          label: "Kickoff",
          href: null,
        },
      ],
    });
    expect(
      JSON.stringify(
        shellRouteContext(`/companias/${companyId}`, {
          "company name": "Kickoff",
        }),
      ),
    ).not.toContain(companyId);
  });

  test("rejects a dynamic route without the required query-context labels", () => {
    expect(() =>
      shellRouteContext(
        "/companias/00000000-0000-0000-0000-000000000651",
      ),
    ).toThrow(/company name/);
  });

  test("fails closed for a path absent from generated route data", () => {
    expect(shellRouteContext("/not-in-navigation-map")).toBeNull();
  });
});
