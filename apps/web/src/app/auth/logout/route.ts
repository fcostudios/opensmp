import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";

import {
  keycloakIssuer,
  signOut,
} from "@/lib/auth/auth-config";
import { keycloakLogoutUrl } from "@/lib/auth/logout-url";
import { publicAppOrigin } from "@/lib/auth/public-app-origin";
import { authLogoutRedirectResponse } from "@/lib/auth/session-cookies";
import { ROUTE_SCR_LOGIN } from "@/lib/routes";

export async function GET(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });
  const postLogoutRedirectUri = new URL(
    ROUTE_SCR_LOGIN,
    publicAppOrigin(),
  ).toString();
  const logoutUrl = keycloakLogoutUrl({
    issuer: keycloakIssuer,
    clientId: process.env.KEYCLOAK_CLIENT_ID ?? "smp-web",
    idToken: typeof token?.idToken === "string" ? token.idToken : undefined,
    postLogoutRedirectUri,
  });

  await signOut({ redirect: false, redirectTo: postLogoutRedirectUri });
  return authLogoutRedirectResponse(
    logoutUrl,
    request.cookies.getAll().map(({ name }) => name),
  );
}
