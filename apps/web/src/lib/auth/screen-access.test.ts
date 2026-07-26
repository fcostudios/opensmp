import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import {
  DEFAULT_ROUTE_BY_ROLE,
  PUBLIC_SCREEN_IDS,
  ROLE_SCREEN_IDS,
  ROUTE_SCREEN_IDS,
  SCREEN_ROLES,
  type ScreenRole,
} from "./screen-access.gen";

interface NavigationMap {
  readonly role_based_views: Record<
    ScreenRole,
    { readonly screens: readonly string[] }
  >;
  readonly routes: readonly {
    readonly auth_required: boolean;
    readonly route: string;
    readonly screen_id: string;
  }[];
}

const navigationMap = JSON.parse(
  readFileSync(
    new URL("../../../../../docs/specs/07c_navigation_map.json", import.meta.url),
    "utf8",
  ),
) as NavigationMap;

describe("generated screen access", () => {
  test("role screen sets are an exact lower-case projection of role_based_views", () => {
    expect(ROLE_SCREEN_IDS).toEqual(
      Object.fromEntries(
        Object.entries(navigationMap.role_based_views).map(
          ([role, view]) => [role, view.screens],
        ),
      ),
    );
    expect(JSON.stringify(ROLE_SCREEN_IDS)).not.toMatch(
      /GROUP_ADMIN|CENTRAL_FINANCE|COMPANY_FINANCE/,
    );
  });

  test("every screen lists exactly the roles whose view contains it", () => {
    const expected = Object.fromEntries(
      [
        ...new Set(
          Object.values(navigationMap.role_based_views).flatMap(
            ({ screens }) => screens,
          ),
        ),
      ].map((screenId) => [
        screenId,
        (
          Object.entries(navigationMap.role_based_views) as [
            ScreenRole,
            { readonly screens: readonly string[] },
          ][]
        )
          .filter(([, view]) => view.screens.includes(screenId))
          .map(([role]) => role),
      ]),
    );

    expect(SCREEN_ROLES).toEqual(expected);
  });

  test("default routes match the role-specific login destinations", () => {
    expect(DEFAULT_ROUTE_BY_ROLE).toEqual({
      public: "/login",
      employee: "/solicitudes",
      approver: "/aprobaciones",
      company_finance: "/estados-de-cuenta",
      central_finance: "/cierre",
      group_admin: "/panel",
      viewer: "/companias/:companyId",
    });
  });

  test("route-to-screen and public-screen data are exact nav-map projections", () => {
    expect(ROUTE_SCREEN_IDS).toEqual(
      Object.fromEntries(
        navigationMap.routes.map(({ route, screen_id: screenId }) => [
          route,
          screenId,
        ]),
      ),
    );
    expect(PUBLIC_SCREEN_IDS).toEqual(
      navigationMap.routes
        .filter(({ auth_required: authRequired }) => !authRequired)
        .map(({ screen_id: screenId }) => screenId),
    );
  });
});
