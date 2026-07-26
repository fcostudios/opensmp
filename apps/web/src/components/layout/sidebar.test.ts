import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import type { LedgerRole } from "@/lib/auth/auth-types";
import {
  activeNavItemId,
  groupedVisibleNavItems,
  visibleNavItems,
} from "./sidebar-access";

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

  test("groups the authorized rail into the three generated sections without empty headings", () => {
    expect(
      groupedVisibleNavItems(["group_admin"]).map(({ id, items }) => ({
        id,
        items: items.map((item) => item.id),
      })),
    ).toEqual([
      {
        id: "operation",
        items: [
          "nav-panel",
          "nav-solicitudes",
          "nav-aprobaciones",
          "nav-reclamaciones",
          "nav-excepciones",
          "nav-cupos",
          "nav-uso",
          "nav-registro",
        ],
      },
      {
        id: "finance",
        items: [
          "nav-estados-de-cuenta",
          "nav-cierre",
          "nav-conciliacion",
          "nav-tarifas",
        ],
      },
      {
        id: "administration",
        items: [
          "nav-companias",
          "nav-personas",
          "nav-organizaciones",
          "nav-credenciales",
          "nav-usuarios",
          "nav-alertas",
          "nav-auditoria",
          "nav-configuracion",
        ],
      },
    ]);
    expect(groupedVisibleNavItems(["employee"])).toMatchObject([
      {
        id: "operation",
        items: [{ id: "nav-solicitudes" }],
      },
    ]);
  });

  test("selects exactly one active destination using registered route boundaries", () => {
    expect(activeNavItemId("/solicitudes")).toBe("nav-solicitudes");
    expect(activeNavItemId("/solicitudes/nueva")).toBe("nav-solicitudes");
    expect(activeNavItemId("/solicitudes/request-42")).toBe(
      "nav-solicitudes",
    );
    expect(activeNavItemId("/uso")).toBe("nav-uso");
    expect(activeNavItemId("/uso-no-registrado")).toBeNull();
  });
});
