import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import type {
  LedgerRole,
  LedgerSessionUser,
} from "./auth-types";
import {
  canAccessRoute,
  matchRoutePolicy,
  ROUTE_POLICIES,
} from "./route-access";

interface NavigationMap {
  readonly role_based_views: Record<
    LedgerRole | "public",
    { readonly screens: readonly string[] }
  >;
  readonly routes: readonly {
    readonly auth_required: boolean;
    readonly roles: readonly (LedgerRole | "public")[];
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
const companyA = "00000000-0000-0000-0000-000000000651";
const companyB = "00000000-0000-0000-0000-000000000652";

function userForRole(role: LedgerRole): LedgerSessionUser {
  return {
    id: `user-${role}`,
    idpSubject: `subject-${role}`,
    email: `${role}@example.test`,
    name: role,
    globalRole:
      role === "group_admin" || role === "central_finance" ? role : null,
    companyGrants:
      role === "approver"
        ? [{ companyId: companyA, role: "approver" }]
        : role === "company_finance"
          ? [{ companyId: companyA, role: "finance" }]
          : role === "viewer"
            ? [{ companyId: companyA, role: "viewer" }]
            : [],
    employeeCompanyId: role === "employee" ? companyA : null,
    roles: [role],
    companyIds:
      role === "group_admin" || role === "central_finance"
        ? [companyA, companyB]
        : [companyA],
    uiLanguage: null,
  };
}

describe("route authorization", () => {
  test("the executable route policy is an exact projection of every navigation-map route", () => {
    const canonicalPolicies = ROUTE_POLICIES.map((policy) => ({
      ...policy,
      roles: [...policy.roles].sort(),
    }));
    const canonicalNavigationRoutes =
      navigationMap.routes.map((route) => ({
        route: route.route,
        screenId: route.screen_id,
        roles: [...route.roles].sort(),
        authRequired: route.auth_required,
      }));

    expect(canonicalPolicies).toEqual(canonicalNavigationRoutes);
  });

  test.each(
    Object.keys(navigationMap.role_based_views) as (LedgerRole | "public")[],
  )("%s can access exactly its declared screens", (role) => {
    const actualScreens = navigationMap.routes
      .filter((route) =>
        canAccessRoute(
          role === "public" ? null : userForRole(role),
          route.route.replace(":companyId", companyA)
            .replace(":requestId", "request-id")
            .replace(":vendorAccountId", "vendor-account-id")
            .replace(":personId", "person-id")
            .replace(":statementId", "statement-id"),
        ),
      )
      .map(({ screen_id: screenId }) => screenId);

    expect([...actualScreens].sort()).toEqual(
      [...navigationMap.role_based_views[role].screens].sort(),
    );
  });

  test("a company-scoped dynamic route also requires membership in the resolved company set", () => {
    const viewer = userForRole("viewer");

    expect(canAccessRoute(viewer, `/companias/${companyA}`)).toBe(true);
    expect(canAccessRoute(viewer, `/companias/${companyB}`)).toBe(false);
    expect(canAccessRoute(userForRole("group_admin"), `/companias/${companyB}`))
      .toBe(true);
  });

  test("unknown routes fail closed and dynamic routes expose their decoded parameters", () => {
    expect(matchRoutePolicy("/not-in-the-navigation-map")).toBeNull();
    expect(
      canAccessRoute(
        userForRole("group_admin"),
        "/not-in-the-navigation-map",
      ),
    ).toBe(false);
    expect(matchRoutePolicy(`/companias/${companyA}`)).toMatchObject({
      policy: {
        route: "/companias/:companyId",
        screenId: "SCR-company-detail",
      },
      params: { companyId: companyA },
    });
  });
});
