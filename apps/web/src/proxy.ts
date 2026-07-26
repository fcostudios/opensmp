import { auth } from "@/lib/auth/auth-config";
import { routeAuthorizationResponse } from "@/lib/auth/route-guard";

export const proxy = auth((request) =>
  routeAuthorizationResponse(request, request.auth?.user ?? null),
);

export const config = {
  matcher: [
    "/((?!api|auth|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
