import { expect, test } from "vitest";

import { authLogoutRedirectResponse } from "./session-cookies";

test("expires every present Auth.js session cookie and chunk on the external logout redirect", () => {
  const response = authLogoutRedirectResponse(
    new URL("https://identity.example/protocol/openid-connect/logout"),
    [
      "authjs.csrf-token",
      "authjs.session-token",
      "authjs.session-token.0",
      "authjs.session-token.12",
      "__Secure-authjs.session-token",
      "__Secure-authjs.session-token.1",
      "other.session-token",
    ],
  );

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    "https://identity.example/protocol/openid-connect/logout",
  );
  expect(response.cookies.getAll().map(({ name }) => name)).toEqual([
    "authjs.session-token",
    "authjs.session-token.0",
    "authjs.session-token.12",
    "__Secure-authjs.session-token",
    "__Secure-authjs.session-token.1",
  ]);
  const setCookies = response.headers.getSetCookie();
  expect(setCookies).toHaveLength(5);
  for (const cookie of setCookies) {
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  }
  expect(
    setCookies.find((cookie) =>
      cookie.startsWith("__Secure-authjs.session-token="),
    ),
  ).toContain("Secure");
  expect(
    setCookies.find((cookie) => cookie.startsWith("authjs.session-token=")),
  ).not.toContain("Secure");
});

test("does not emit broad deletion cookies when no Auth.js session cookie is present", () => {
  const response = authLogoutRedirectResponse(
    new URL("https://identity.example/logout"),
    ["authjs.csrf-token", "unrelated"],
  );

  expect(response.cookies.getAll()).toEqual([]);
});
