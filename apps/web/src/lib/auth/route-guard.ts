import { NextResponse, type NextRequest } from "next/server";

import type { LedgerSessionUser } from "./auth-types";
import {
  canAccessRoute,
  matchRoutePolicy,
} from "./route-access";

export function routeAuthorizationResponse(
  request: NextRequest,
  user: LedgerSessionUser | null,
): NextResponse {
  const { pathname } = request.nextUrl;
  const match = matchRoutePolicy(pathname);

  if (match?.policy.authRequired && !user) {
    const login = new URL("/login", request.nextUrl);
    login.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(login);
  }
  if (!canAccessRoute(user, pathname)) {
    return NextResponse.redirect(
      new URL("/acceso-denegado", request.nextUrl),
    );
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-ledger-pathname", pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export function authenticatedRouteRedirect(
  user: LedgerSessionUser | null,
  pathname: string | null,
): "/login" | "/acceso-denegado" | null {
  if (!user) return "/login";
  if (!pathname || !canAccessRoute(user, pathname)) {
    return "/acceso-denegado";
  }
  return null;
}
