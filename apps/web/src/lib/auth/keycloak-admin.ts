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

export class KeycloakAdminError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number | null,
  ) {
    super(
      `Keycloak admin operation ${operation} failed` +
        (status === null ? "" : ` with status ${status}`),
    );
    this.name = "KeycloakAdminError";
  }
}

export interface KeycloakAdminClientOptions {
  readonly baseUrl: string;
  readonly realm: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

type TokenState = {
  accessToken: string;
  expiresAt: number;
};

export function createKeycloakAdminClient({
  baseUrl,
  realm,
  clientId,
  clientSecret,
}: KeycloakAdminClientOptions): KeycloakAdminPort & KeycloakSecurityEventPort {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const realmPath = encodeURIComponent(realm);
  let tokenState: TokenState | null = null;
  let platformAdminGroupId: string | null = null;

  async function accessToken(forceRefresh = false): Promise<string> {
    if (
      !forceRefresh &&
      tokenState &&
      tokenState.expiresAt > Date.now() + 5_000
    ) {
      return tokenState.accessToken;
    }

    let response: Response;
    try {
      response = await fetch(
        `${normalizedBaseUrl}/realms/${realmPath}/protocol/openid-connect/token`,
        {
          method: "POST",
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "client_credentials",
          }),
        },
      );
    } catch {
      throw new KeycloakAdminError("obtain-service-token", null);
    }
    if (!response.ok) {
      throw new KeycloakAdminError("obtain-service-token", response.status);
    }

    let payload: { access_token?: unknown; expires_in?: unknown };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      throw new KeycloakAdminError("obtain-service-token", response.status);
    }
    if (
      typeof payload.access_token !== "string" ||
      typeof payload.expires_in !== "number"
    ) {
      throw new KeycloakAdminError("obtain-service-token", response.status);
    }
    tokenState = {
      accessToken: payload.access_token,
      expiresAt: Date.now() + payload.expires_in * 1_000,
    };
    return tokenState.accessToken;
  }

  async function adminRequest(
    operation: string,
    path: string,
    init: RequestInit = {},
    retryAfterUnauthorized = true,
  ): Promise<Response> {
    const token = await accessToken(!retryAfterUnauthorized);
    let response: Response;
    try {
      response = await fetch(
        `${normalizedBaseUrl}/admin/realms/${realmPath}${path}`,
        {
          ...init,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(init.body ? { "Content-Type": "application/json" } : {}),
            ...init.headers,
          },
        },
      );
    } catch {
      throw new KeycloakAdminError(operation, null);
    }

    if (response.status === 401 && retryAfterUnauthorized) {
      tokenState = null;
      return adminRequest(operation, path, init, false);
    }
    if (!response.ok) {
      throw new KeycloakAdminError(operation, response.status);
    }
    return response;
  }

  async function groupId(): Promise<string> {
    if (platformAdminGroupId) return platformAdminGroupId;
    const response = await adminRequest(
      "resolve-platform-admin-group",
      "/group-by-path/platform-admin",
    );
    let group: { id?: unknown };
    try {
      group = (await response.json()) as typeof group;
    } catch {
      throw new KeycloakAdminError(
        "resolve-platform-admin-group",
        response.status,
      );
    }
    if (typeof group.id !== "string") {
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
      await adminRequest(
        "add-platform-admin-membership",
        `/users/${encodeURIComponent(idpSubject)}/groups/${encodeURIComponent(await groupId())}`,
        { method: "PUT" },
      );
      await adminRequest(
        "revoke-user-sessions-after-platform-admin-membership",
        `/users/${encodeURIComponent(idpSubject)}/logout`,
        { method: "POST" },
      );
    },

    async removeUserFromPlatformAdmin(idpSubject) {
      await adminRequest(
        "remove-platform-admin-membership",
        `/users/${encodeURIComponent(idpSubject)}/groups/${encodeURIComponent(await groupId())}`,
        { method: "DELETE" },
      );
    },

    async disableUser(idpSubject) {
      await adminRequest(
        "disable-user",
        `/users/${encodeURIComponent(idpSubject)}`,
        {
          method: "PUT",
          body: JSON.stringify({ enabled: false }),
        },
      );
    },

    async revokeSessions(idpSubject) {
      await adminRequest(
        "revoke-user-sessions",
        `/users/${encodeURIComponent(idpSubject)}/logout`,
        { method: "POST" },
      );
    },

    async listSecurityEvents({ types, max }) {
      const query = new URLSearchParams({ max: String(max) });
      for (const type of types) query.append("type", type);
      const response = await adminRequest(
        "query-security-events",
        `/events?${query}`,
      );
      let events: Array<{
        clientId?: unknown;
        error?: unknown;
        time?: unknown;
        type?: unknown;
        userId?: unknown;
      }>;
      try {
        events = (await response.json()) as typeof events;
      } catch {
        throw new KeycloakAdminError("query-security-events", response.status);
      }
      if (!Array.isArray(events)) {
        throw new KeycloakAdminError("query-security-events", response.status);
      }
      return events.map((event) => {
        if (typeof event.type !== "string" || typeof event.time !== "number") {
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
