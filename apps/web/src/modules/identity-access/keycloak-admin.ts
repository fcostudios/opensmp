import {
  createKeycloakAdminTransport,
  KeycloakAdminError,
  readKeycloakJson,
  type KeycloakAdminTransportOptions,
} from "../../lib/auth/keycloak-admin-transport";

export interface KeycloakAdminClient {
  createUser(input: {
    email: string;
    displayName: string;
    provisioningOperationId: string;
  }): Promise<{ idpSubject: string }>;
  findUserByEmail(email: string): Promise<{
    idpSubject: string;
    provisioningOperationId: string | null;
  } | null>;
  disableUser(idpSubject: string): Promise<void>;
  revokeSessions(idpSubject: string): Promise<void>;
  addUserToPlatformAdmin(idpSubject: string): Promise<void>;
  deleteUser(idpSubject: string): Promise<void>;
  listOtpCredentials(
    idpSubject: string,
  ): Promise<readonly { id: string }[]>;
  removeOtpCredential(
    idpSubject: string,
    credentialId: string,
  ): Promise<void>;
  addRequiredAction(
    idpSubject: string,
    action: "CONFIGURE_TOTP",
  ): Promise<void>;
}

export interface KeycloakAdminHttpClientOptions
  extends KeycloakAdminTransportOptions {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function idpSubjectFromLocation(
  location: string | null,
  realm: string,
): string | null {
  if (!location) return null;
  try {
    const url = new URL(location);
    const segments = url.pathname.split("/").filter(Boolean);
    if (
      segments.length !== 5 ||
      segments[0] !== "admin" ||
      segments[1] !== "realms" ||
      decodeURIComponent(segments[2] ?? "") !== realm ||
      segments[3] !== "users"
    ) {
      return null;
    }
    const idpSubject = decodeURIComponent(segments[4] ?? "").trim();
    return idpSubject.length > 0 ? idpSubject : null;
  } catch {
    return null;
  }
}

export function createKeycloakAdminHttpClient({
  baseUrl,
  realm,
  clientId,
  clientSecret,
  now,
}: KeycloakAdminHttpClientOptions): KeycloakAdminClient {
  const transport = createKeycloakAdminTransport({
    baseUrl,
    realm,
    clientId,
    clientSecret,
    now,
  });
  let platformAdminGroupId: string | null = null;

  async function groupId(): Promise<string> {
    if (platformAdminGroupId) return platformAdminGroupId;
    const response = await transport.request("resolve-platform-admin-group", "/group-by-path/platform-admin");
    const payload = await readKeycloakJson(response, "resolve-platform-admin-group");
    if (!isRecord(payload) || typeof payload.id !== "string" || !payload.id.trim()) {
      throw new KeycloakAdminError("resolve-platform-admin-group", response.status);
    }
    platformAdminGroupId = payload.id;
    return payload.id;
  }

  return {
    async findUserByEmail(email) {
      const query = new URLSearchParams({ email, exact: "true" });
      const response = await transport.request("find-user-by-email", `/users?${query}`);
      const payload = await readKeycloakJson(response, "find-user-by-email");
      if (!Array.isArray(payload) || payload.length > 1) throw new KeycloakAdminError("find-user-by-email", response.status);
      if (payload.length === 0) return null;
      const candidate = payload[0];
      if (!isRecord(candidate) || typeof candidate.id !== "string" || !candidate.id.trim()) {
        throw new KeycloakAdminError("find-user-by-email", response.status);
      }
      const attributes = candidate.attributes;
      const marker = isRecord(attributes) ? attributes.ledgerProvisioningOperationId : undefined;
      let provisioningOperationId: string | null = null;
      if (marker !== undefined && (!Array.isArray(marker) || marker.length !== 1 || typeof marker[0] !== "string" || !marker[0])) {
        throw new KeycloakAdminError("find-user-by-email", response.status);
      }
      if (Array.isArray(marker)) provisioningOperationId = marker[0] as string;
      return { idpSubject: candidate.id, provisioningOperationId };
    },
    async createUser({ email, displayName, provisioningOperationId }) {
      const response = await transport.request("create-user", "/users", {
        method: "POST",
        body: JSON.stringify({
          username: email,
          email,
          firstName: displayName,
          enabled: true,
          attributes: { ledgerProvisioningOperationId: [provisioningOperationId] },
        }),
      });
      const idpSubject = idpSubjectFromLocation(
        response.headers.get("location"),
        realm,
      );
      if (!idpSubject) {
        throw new KeycloakAdminError("create-user", response.status);
      }
      return { idpSubject };
    },

    async disableUser(idpSubject) {
      await transport.request(
        "disable-user",
        `/users/${encodeURIComponent(idpSubject)}`,
        { method: "PUT", body: JSON.stringify({ enabled: false }) },
      );
    },

    async revokeSessions(idpSubject) {
      await transport.request("revoke-user-sessions", `/users/${encodeURIComponent(idpSubject)}/logout`, { method: "POST" });
    },

    async addUserToPlatformAdmin(idpSubject) {
      await transport.request(
        "add-platform-admin-membership",
        `/users/${encodeURIComponent(idpSubject)}/groups/${encodeURIComponent(await groupId())}`,
        { method: "PUT" },
      );
    },

    async deleteUser(idpSubject) {
      try {
        await transport.request(
          "delete-user",
          `/users/${encodeURIComponent(idpSubject)}`,
          { method: "DELETE" },
        );
      } catch (error) {
        if (!(error instanceof KeycloakAdminError) || error.status !== 404) throw error;
      }
    },

    async listOtpCredentials(idpSubject) {
      const response = await transport.request(
        "list-otp-credentials",
        `/users/${encodeURIComponent(idpSubject)}/credentials`,
      );
      const payload = await readKeycloakJson(response, "list-otp-credentials");
      if (!Array.isArray(payload)) {
        throw new KeycloakAdminError(
          "list-otp-credentials",
          response.status,
        );
      }
      const credentials: Array<{ id: string; type: string }> = [];
      for (const credential of payload) {
        if (
          !isRecord(credential) ||
          typeof credential.id !== "string" ||
          credential.id.trim().length === 0 ||
          typeof credential.type !== "string" ||
          credential.type.trim().length === 0
        ) {
          throw new KeycloakAdminError(
            "list-otp-credentials",
            response.status,
          );
        }
        credentials.push({ id: credential.id, type: credential.type });
      }
      return credentials.flatMap(({ id, type }) =>
        type === "otp" ? [{ id }] : [],
      );
    },

    async removeOtpCredential(idpSubject, credentialId) {
      await transport.request(
        "remove-otp-credential",
        `/users/${encodeURIComponent(idpSubject)}/credentials/${encodeURIComponent(credentialId)}`,
        { method: "DELETE" },
      );
    },

    async addRequiredAction(idpSubject, action) {
      const path = `/users/${encodeURIComponent(idpSubject)}`;
      const response = await transport.request("read-required-actions", path);
      const payload = await readKeycloakJson(response, "read-required-actions");
      if (!isRecord(payload) || !Array.isArray(payload.requiredActions)) {
        throw new KeycloakAdminError("read-required-actions", response.status);
      }
      const requiredActions: string[] = [];
      for (const requiredAction of payload.requiredActions) {
        if (
          typeof requiredAction !== "string" ||
          requiredAction.trim().length === 0
        ) {
          throw new KeycloakAdminError(
            "read-required-actions",
            response.status,
          );
        }
        requiredActions.push(requiredAction);
      }
      await transport.request(
        "add-required-action",
        path,
        {
          method: "PUT",
          body: JSON.stringify({
            requiredActions: [...new Set([...requiredActions, action])],
          }),
        },
      );
    },
  };
}

export function keycloakUserAdminFromEnvironment(): KeycloakAdminClient {
  const baseUrl = process.env.KEYCLOAK_ADMIN_BASE_URL;
  const clientSecret = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET;
  if (!baseUrl || !clientSecret) {
    throw new Error("Keycloak user-administration service is not configured");
  }
  return createKeycloakAdminHttpClient({
    baseUrl,
    realm: process.env.KEYCLOAK_REALM ?? "corporativo",
    clientId: process.env.KEYCLOAK_ADMIN_CLIENT_ID ?? "smp-keycloak-admin",
    clientSecret,
  });
}

export interface InMemoryKeycloakAdminUser {
  readonly email: string;
  readonly displayName: string;
  enabled: boolean;
  otpCredentials: Array<{ id: string }>;
  requiredActions: Set<"CONFIGURE_TOTP">;
  platformAdmin?: boolean;
  provisioningOperationId?: string;
  sessionsRevoked?: number;
}

export interface InMemoryKeycloakAdminState {
  nextSubject: number;
  readonly users: Map<string, InMemoryKeycloakAdminUser>;
}

export function createInMemoryKeycloakAdminClient(
  state: InMemoryKeycloakAdminState = {
    nextSubject: 1,
    users: new Map(),
  },
): KeycloakAdminClient {
  function user(idpSubject: string): InMemoryKeycloakAdminUser {
    const existing = state.users.get(idpSubject);
    if (!existing) {
      throw new KeycloakAdminError("resolve-in-memory-user", 404);
    }
    return existing;
  }

  return {
    async findUserByEmail(email) {
      for (const [idpSubject, candidate] of state.users) {
        if (candidate.email === email) {
          return { idpSubject, provisioningOperationId: candidate.provisioningOperationId ?? null };
        }
      }
      return null;
    },
    async createUser({ email, displayName, provisioningOperationId }) {
      const idpSubject = `in-memory-user-${state.nextSubject++}`;
      state.users.set(idpSubject, {
        email,
        displayName,
        enabled: true,
        otpCredentials: [],
        provisioningOperationId,
        requiredActions: new Set(),
      });
      return { idpSubject };
    },

    async disableUser(idpSubject) {
      user(idpSubject).enabled = false;
    },

    async revokeSessions(idpSubject) {
      const existing = user(idpSubject);
      existing.sessionsRevoked = (existing.sessionsRevoked ?? 0) + 1;
    },

    async addUserToPlatformAdmin(idpSubject) {
      user(idpSubject).platformAdmin = true;
    },

    async deleteUser(idpSubject) {
      state.users.delete(idpSubject);
    },

    async listOtpCredentials(idpSubject) {
      return user(idpSubject).otpCredentials.map(({ id }) => ({ id }));
    },

    async removeOtpCredential(idpSubject, credentialId) {
      const existing = user(idpSubject);
      existing.otpCredentials = existing.otpCredentials.filter(
        ({ id }) => id !== credentialId,
      );
    },

    async addRequiredAction(idpSubject, action) {
      user(idpSubject).requiredActions.add(action);
    },
  };
}
