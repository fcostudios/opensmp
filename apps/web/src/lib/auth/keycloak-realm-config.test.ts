import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

type RealmExport = {
  realm: string;
  browserFlow?: string;
  eventsEnabled?: boolean;
  eventsExpiration?: number;
  enabledEventTypes?: string[];
  roles?: { realm?: Array<{ name: string }> };
  groups?: Array<{ name: string; realmRoles?: string[] }>;
  clients?: Array<{
    clientId: string;
    secret?: string;
    publicClient?: boolean;
    standardFlowEnabled?: boolean;
    implicitFlowEnabled?: boolean;
    directAccessGrantsEnabled?: boolean;
    serviceAccountsEnabled?: boolean;
    redirectUris?: string[];
    attributes?: Record<string, string>;
  }>;
  users?: Array<{
    username?: string;
    serviceAccountClientId?: string;
    credentials?: unknown[];
    clientRoles?: Record<string, string[]>;
  }>;
  authenticationFlows?: Array<{
    alias: string;
    authenticationExecutions?: Array<{
      authenticator?: string;
      authenticatorConfig?: string;
      flowAlias?: string;
      requirement?: string;
    }>;
  }>;
  authenticatorConfig?: Array<{
    alias: string;
    config: Record<string, string>;
  }>;
};

async function productionRealm(): Promise<RealmExport> {
  const path = resolve(
    import.meta.dirname,
    "../../../../../infra/keycloak/realm-corporativo.json",
  );
  return JSON.parse(await readFile(path, "utf8")) as RealmExport;
}

describe("production Keycloak realm export", () => {
  test("contains only the technical platform-admin role and no fixture identities or secrets", async () => {
    const realm = await productionRealm();

    expect(realm.realm).toBe("corporativo");
    expect(realm.roles?.realm?.map(({ name }) => name)).toEqual([
      "platform-admin",
    ]);
    expect(realm.groups).toEqual([
      { name: "platform-admin", path: "/platform-admin", realmRoles: ["platform-admin"] },
    ]);
    expect(
      realm.users?.filter(({ serviceAccountClientId }) => !serviceAccountClientId),
    ).toEqual([]);
    expect(realm.users?.flatMap(({ credentials }) => credentials ?? [])).toEqual(
      [],
    );

    const serialized = JSON.stringify(realm);
    for (const forbidden of [
      '"seller"',
      '"manager"',
      '"director"',
      '"group_admin"',
      '"central_finance"',
      '"approver"',
      '"finance"',
      '"viewer"',
      '"password123"',
      '"change-me"',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("uses confidential least-surface clients, exact callback, and S256 PKCE", async () => {
    const realm = await productionRealm();
    const web = realm.clients?.find(({ clientId }) => clientId === "smp-web");
    const admin = realm.clients?.find(
      ({ clientId }) => clientId === "smp-keycloak-admin",
    );

    expect(web).toMatchObject({
      publicClient: false,
      standardFlowEnabled: true,
      implicitFlowEnabled: false,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
      redirectUris: [
        "${LEDGER_PUBLIC_URL:http://localhost:3000}/api/auth/callback/keycloak",
      ],
      attributes: expect.objectContaining({
        "pkce.code.challenge.method": "S256",
      }),
      secret: "${SMP_WEB_CLIENT_SECRET}",
    });
    expect(admin).toMatchObject({
      publicClient: false,
      standardFlowEnabled: false,
      implicitFlowEnabled: false,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: true,
      secret: "${SMP_KEYCLOAK_ADMIN_CLIENT_SECRET}",
    });
  });

  test("binds conditional platform-admin OTP and retains queryable security events for 90 days", async () => {
    const realm = await productionRealm();
    const condition = realm.authenticatorConfig?.find(
      ({ alias }) => alias === "platform-admin-role-condition",
    );
    const otpFlow = realm.authenticationFlows?.find(
      ({ alias }) => alias === "ledger-platform-admin-otp",
    );

    expect(realm.browserFlow).toBe("ledger-browser");
    expect(condition).toEqual({
      alias: "platform-admin-role-condition",
      config: { condUserRole: "platform-admin" },
    });
    expect(otpFlow?.authenticationExecutions).toEqual([
      expect.objectContaining({
        authenticator: "conditional-user-role",
        authenticatorConfig: "platform-admin-role-condition",
        requirement: "REQUIRED",
      }),
      expect.objectContaining({
        authenticator: "auth-otp-form",
        requirement: "REQUIRED",
      }),
    ]);
    expect(realm.eventsEnabled).toBe(true);
    expect(realm.eventsExpiration).toBe(7_776_000);
    expect(realm.enabledEventTypes).toEqual(
      expect.arrayContaining([
        "LOGIN",
        "LOGIN_ERROR",
        "LOGOUT",
        "UPDATE_TOTP",
        "UPDATE_TOTP_ERROR",
      ]),
    );
  });

  test("grants the service account only the required realm-management roles", async () => {
    const realm = await productionRealm();
    const serviceAccount = realm.users?.find(
      ({ serviceAccountClientId }) =>
        serviceAccountClientId === "smp-keycloak-admin",
    );

    expect(serviceAccount?.clientRoles?.["realm-management"]?.sort()).toEqual([
      "manage-users",
      "query-groups",
      "view-events",
      "view-users",
    ]);
    expect(
      serviceAccount?.clientRoles?.["realm-management"],
    ).not.toContain("realm-admin");
  });
});
