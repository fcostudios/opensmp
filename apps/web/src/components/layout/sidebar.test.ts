import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import type { LedgerRole } from "@/lib/auth/auth-types";
import { visibleNavItems } from "./sidebar-access";

interface NavigationMap {
  readonly role_based_views: Record<
    LedgerRole | "public",
    { readonly sidebar: readonly string[] }
  >;
}

const navigationMap = JSON.parse(
  readFileSync(
    new URL("../../../../../docs/specs/07c_navigation_map.json", import.meta.url),
    "utf8",
  ),
) as NavigationMap;

describe("sidebar access", () => {
  test.each([
    ["unauthenticated", undefined],
    ["no roles", []],
    ["unknown role", ["future_super_admin"]],
    ["viewer", ["viewer"]],
  ] as const)("%s fails closed", (_case, roles) => {
    expect(visibleNavItems(roles).map(({ id }) => id)).toEqual([]);
  });

  test.each(
    Object.keys(navigationMap.role_based_views).filter(
      (role) => role !== "public",
    ) as LedgerRole[],
  )("%s receives exactly its declared sidebar", (role) => {
    expect(visibleNavItems([role]).map(({ id }) => id)).toEqual(
      navigationMap.role_based_views[role].sidebar,
    );
  });

  test("multiple roles receive only the union of explicitly declared items", () => {
    expect(
      visibleNavItems(["approver", "company_finance"]).map(({ id }) => id),
    ).toEqual([
      "nav-solicitudes",
      "nav-aprobaciones",
      "nav-reclamaciones",
      "nav-estados-de-cuenta",
    ]);
  });
});
