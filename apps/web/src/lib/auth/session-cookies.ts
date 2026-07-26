import { NextResponse } from "next/server";

const authSessionCookiePattern =
  /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/;

export function authLogoutRedirectResponse(
  logoutUrl: URL,
  requestCookieNames: readonly string[],
): NextResponse {
  const response = NextResponse.redirect(logoutUrl);
  for (const name of requestCookieNames) {
    if (!authSessionCookiePattern.test(name)) continue;
    response.cookies.set({
      name,
      value: "",
      expires: new Date(0),
      httpOnly: true,
      maxAge: 0,
      path: "/",
      sameSite: "lax",
      secure: name.startsWith("__Secure-"),
    });
  }
  return response;
}
