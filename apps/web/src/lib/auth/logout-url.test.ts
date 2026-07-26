import { expect, test } from "vitest";

import { keycloakLogoutUrl } from "./logout-url";

test("builds an RP-initiated logout with the server-only ID token and exact return URI", () => {
  const logout = keycloakLogoutUrl({
    issuer: "https://identity.example/realms/corporativo/",
    clientId: "smp-web",
    idToken: "server-only-id-token",
    postLogoutRedirectUri: "https://ledger.example/login",
  });

  expect(logout.origin + logout.pathname).toBe(
    "https://identity.example/realms/corporativo/protocol/openid-connect/logout",
  );
  expect(Object.fromEntries(logout.searchParams)).toEqual({
    client_id: "smp-web",
    id_token_hint: "server-only-id-token",
    post_logout_redirect_uri: "https://ledger.example/login",
  });
});
