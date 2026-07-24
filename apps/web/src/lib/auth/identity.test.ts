import { describe, expect, it } from "vitest";

import { projectLedgerSessionIdentity } from "./identity";

describe("projectLedgerSessionIdentity", () => {
  it("exposes only OIDC identity when Keycloak includes realm roles and an organization claim", () => {
    const sessionIdentity = projectLedgerSessionIdentity({
      sub: "keycloak-user-123",
      name: "Ledger User",
      email: "ledger.user@example.com",
      realm_access: { roles: ["platform-admin"] },
      org_id: "company-456",
    });

    expect(sessionIdentity).toEqual({
      id: "keycloak-user-123",
      name: "Ledger User",
      email: "ledger.user@example.com",
    });
  });
});
