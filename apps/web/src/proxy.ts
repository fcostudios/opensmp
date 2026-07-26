import { auth } from "@/lib/auth/auth-config";
import { routeAuthenticationResponse } from "@/lib/auth/route-guard";

export const proxy = auth((request) =>
  routeAuthenticationResponse(request, Boolean(request.auth)),
);

export const config = {
  matcher: [
    "/((?!api|auth|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
