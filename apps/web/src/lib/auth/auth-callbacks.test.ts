import { expect, test } from "vitest";

import type { LedgerSessionUser } from "./auth-types";
import {
  exposeLedgerSession,
  projectKeycloakJwt,
  safeAuthRedirect,
} from "./auth-callbacks";

test("keeps the ID token server-side while discarding provider bearer tokens and role claims", () => {
  const token = projectKeycloakJwt(
    {
      accessToken: "legacy-browser-bearer",
      access_token: "provider-access-token",
      id_token: "legacy-id-token-name",
      exp: 1_900_000_000,
    },
    { idToken: "server-only-id-token" },
    {
      sub: "keycloak-subject",
      name: "Ledger User",
      email: "ledger.user@example.com",
      email_verified: true,
      realm_access: { roles: ["platform-admin", "group_admin"] },
      resource_access: { ledger: { roles: ["central_finance"] } },
      org_id: "untrusted-company",
    },
  );

  expect(token).toMatchObject({
    idpSubject: "keycloak-subject",
    displayName: "Ledger User",
    idToken: "server-only-id-token",
    exp: 1_900_000_000,
  });
  expect(token).not.toHaveProperty("accessToken");
  expect(token).not.toHaveProperty("access_token");
  expect(token).not.toHaveProperty("id_token");
  expect(JSON.stringify(token)).not.toContain("platform-admin");
  expect(JSON.stringify(token)).not.toContain("group_admin");
  expect(JSON.stringify(token)).not.toContain("central_finance");
  expect(JSON.stringify(token)).not.toContain("untrusted-company");
});

test("exposes only the Ledger-loaded authorization session to browser code", () => {
  const ledgerUser: LedgerSessionUser = {
    id: "20000000-0000-0000-0000-000000000001",
    idpSubject: "keycloak-subject",
    email: "ledger.user@example.com",
    name: "Ledger User",
    globalRole: "group_admin",
    companyGrants: [],
    uiLanguage: "es",
  };

  const session = exposeLedgerSession(
    {
      expires: "2026-07-26T00:00:00.000Z",
      user: { name: "untrusted provider projection" },
      accessToken: "must-not-survive",
      idToken: "must-not-survive",
    },
    ledgerUser,
  );

  expect(session).toEqual({
    expires: "2026-07-26T00:00:00.000Z",
    user: ledgerUser,
  });
  expect(JSON.stringify(session)).not.toContain("must-not-survive");
});

test("routes successful default callbacks through role landing and rejects external redirects", () => {
  const baseUrl = "https://ledger.example";

  expect(safeAuthRedirect({ url: baseUrl, baseUrl })).toBe(
    "https://ledger.example/auth/landing",
  );
  expect(safeAuthRedirect({ url: "/", baseUrl })).toBe(
    "https://ledger.example/auth/landing",
  );
  expect(safeAuthRedirect({ url: "/auth/landing", baseUrl })).toBe(
    "https://ledger.example/auth/landing",
  );
  expect(
    safeAuthRedirect({
      url: "https://attacker.example/steal",
      baseUrl,
    }),
  ).toBe("https://ledger.example/auth/landing");
  for (const hostile of [
    "//attacker.example/steal",
    "///attacker.example/steal",
    "/\\attacker.example/steal",
    "\\\\attacker.example/steal",
    "https://ledger.example.attacker.example/steal",
  ]) {
    expect(safeAuthRedirect({ url: hostile, baseUrl })).toBe(
      "https://ledger.example/auth/landing",
    );
  }
  expect(
    safeAuthRedirect({
      url: "/%2f%2fattacker.example/steal",
      baseUrl,
    }),
  ).toBe("https://ledger.example/%2f%2fattacker.example/steal");
});

test.each([
  "javascript:alert(1)",
  "ftp://ledger.example",
  "https://user:secret@ledger.example",
  "https://ledger.example/path",
])("rejects an invalid Auth.js base URL: %s", (baseUrl) => {
  expect(() => safeAuthRedirect({ url: "/solicitudes", baseUrl })).toThrow(
    "valid application origin",
  );
});
