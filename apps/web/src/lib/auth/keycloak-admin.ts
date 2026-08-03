import {
  createKeycloakAdminTransport,
  KeycloakAdminError,
  readKeycloakJson,
} from "./keycloak-admin-transport";

export { KeycloakAdminError } from "./keycloak-admin-transport";

export interface KeycloakAdminPort {
  addUserToPlatformAdmin(idpSubject: string): Promise<void>;
  removeUserFromPlatformAdmin(idpSubject: string): Promise<void>;
  disableUser(idpSubject: string): Promise<void>;
  revokeSessions(idpSubject: string): Promise<void>;
}

export interface KeycloakSecurityEvent {
  readonly clientId: string | null;
  readonly error: string | null;
  readonly time: number;
  readonly type: string;
  readonly userId: string | null;
}

export interface KeycloakSecurityEventPort {
  listSecurityEvents(input: {
    readonly types: readonly string[];
    readonly max: number;
  }): Promise<readonly KeycloakSecurityEvent[]>;
}

export interface KeycloakAdminClientOptions {
  readonly baseUrl: string;
  readonly realm: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export function createKeycloakAdminClient({
  baseUrl,
  realm,
  clientId,
  clientSecret,
}: KeycloakAdminClientOptions): KeycloakAdminPort & KeycloakSecurityEventPort {
  const transport = createKeycloakAdminTransport({
    baseUrl,
    realm,
    clientId,
    clientSecret,
  });
  let platformAdminGroupId: string | null = null;

  async function groupId(): Promise<string> {
    if (platformAdminGroupId) return platformAdminGroupId;
    const response = await transport.request(
      "resolve-platform-admin-group",
      "/group-by-path/platform-admin",
    );
    const group = await readKeycloakJson(
      response,
      "resolve-platform-admin-group",
    );
    if (
      typeof group !== "object" ||
      group === null ||
      Array.isArray(group) ||
      !("id" in group) ||
      typeof group.id !== "string" ||
      group.id.trim().length === 0
    ) {
      throw new KeycloakAdminError(
        "resolve-platform-admin-group",
        response.status,
      );
    }
    platformAdminGroupId = group.id;
    return group.id;
  }

  return {
    async addUserToPlatformAdmin(idpSubject) {
      await transport.request(
        "add-platform-admin-membership",
        `/users/${encodeURIComponent(idpSubject)}/groups/${encodeURIComponent(await groupId())}`,
        { method: "PUT" },
      );
      await transport.request(
        "revoke-user-sessions-after-platform-admin-membership",
        `/users/${encodeURIComponent(idpSubject)}/logout`,
        { method: "POST" },
      );
    },

    async removeUserFromPlatformAdmin(idpSubject) {
      await transport.request(
        "remove-platform-admin-membership",
        `/users/${encodeURIComponent(idpSubject)}/groups/${encodeURIComponent(await groupId())}`,
        { method: "DELETE" },
      );
    },

    async disableUser(idpSubject) {
      await transport.request(
        "disable-user",
        `/users/${encodeURIComponent(idpSubject)}`,
        {
          method: "PUT",
          body: JSON.stringify({ enabled: false }),
        },
      );
    },

    async revokeSessions(idpSubject) {
      await transport.request(
        "revoke-user-sessions",
        `/users/${encodeURIComponent(idpSubject)}/logout`,
        { method: "POST" },
      );
    },

    async listSecurityEvents({ types, max }) {
      const query = new URLSearchParams({ max: String(max) });
      for (const type of types) query.append("type", type);
      const response = await transport.request(
        "query-security-events",
        `/events?${query}`,
      );
      const events = await readKeycloakJson(
        response,
        "query-security-events",
      );
      if (!Array.isArray(events)) {
        throw new KeycloakAdminError("query-security-events", response.status);
      }
      return events.map((event) => {
        if (
          typeof event !== "object" ||
          event === null ||
          Array.isArray(event) ||
          typeof event.type !== "string" ||
          typeof event.time !== "number"
        ) {
          throw new KeycloakAdminError(
            "query-security-events",
            response.status,
          );
        }
        return {
          clientId:
            typeof event.clientId === "string" ? event.clientId : null,
          error: typeof event.error === "string" ? event.error : null,
          time: event.time,
          type: event.type,
          userId: typeof event.userId === "string" ? event.userId : null,
        };
      });
    },
  };
}

export function keycloakAdminFromEnvironment(): KeycloakAdminPort &
  KeycloakSecurityEventPort {
  const baseUrl = process.env.KEYCLOAK_ADMIN_BASE_URL;
  const clientSecret = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET;
  if (!baseUrl || !clientSecret) {
    throw new Error(
      "KEYCLOAK_ADMIN_BASE_URL and KEYCLOAK_ADMIN_CLIENT_SECRET are required",
    );
  }
  return createKeycloakAdminClient({
    baseUrl,
    realm: process.env.KEYCLOAK_REALM ?? "corporativo",
    clientId: process.env.KEYCLOAK_ADMIN_CLIENT_ID ?? "smp-keycloak-admin",
    clientSecret,
  });
}
