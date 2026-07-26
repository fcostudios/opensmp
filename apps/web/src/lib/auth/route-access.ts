import type {
  LedgerRole,
  LedgerSessionUser,
} from "./auth-types";
import {
  PUBLIC_SCREEN_IDS,
  ROUTE_SCREEN_IDS,
  SCREEN_ROLES,
} from "./screen-access.gen";

export interface RoutePolicy {
  readonly route: string;
  readonly screenId: string;
  readonly roles: readonly (LedgerRole | "public")[];
  readonly authRequired: boolean;
}

const publicScreens = new Set<string>(PUBLIC_SCREEN_IDS);

export const ROUTE_POLICIES: readonly RoutePolicy[] = Object.entries(
  ROUTE_SCREEN_IDS,
).map(([route, screenId]) => {
  const authRequired = !publicScreens.has(screenId);
  return {
    route,
    screenId,
    roles: authRequired
      ? (SCREEN_ROLES[screenId] as readonly LedgerRole[])
      : ["public"],
    authRequired,
  };
});

export interface MatchedRoutePolicy {
  readonly policy: RoutePolicy;
  readonly params: Readonly<Record<string, string>>;
}

function segments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

export function matchRoutePolicy(
  pathname: string,
): MatchedRoutePolicy | null {
  const pathnameSegments = segments(pathname);
  for (const policy of ROUTE_POLICIES) {
    const policySegments = segments(policy.route);
    if (policySegments.length !== pathnameSegments.length) continue;
    const params: Record<string, string> = {};
    let matches = true;
    for (let index = 0; index < policySegments.length; index += 1) {
      const expected = policySegments[index]!;
      const actual = pathnameSegments[index]!;
      if (expected.startsWith(":")) {
        try {
          params[expected.slice(1)] = decodeURIComponent(actual);
        } catch {
          matches = false;
          break;
        }
      } else if (expected !== actual) {
        matches = false;
        break;
      }
    }
    if (matches) return { policy, params };
  }
  return null;
}

export function canAccessRoute(
  user: LedgerSessionUser | null,
  pathname: string,
): boolean {
  const match = matchRoutePolicy(pathname);
  if (!match) return false;
  if (!match.policy.authRequired) return true;
  if (!user) return false;
  if (
    !match.policy.roles.some((role) =>
      user.roles.includes(role as LedgerRole),
    )
  ) {
    return false;
  }
  const companyId = match.params.companyId;
  return !companyId || user.companyIds.includes(companyId);
}
