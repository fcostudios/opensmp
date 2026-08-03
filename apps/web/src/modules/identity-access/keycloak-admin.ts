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
  }): Promise<{ idpSubject: string }>;
  disableUser(idpSubject: string): Promise<void>;
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

  return {
    async createUser({ email, displayName }) {
      const response = await transport.request("create-user", "/users", {
        method: "POST",
        body: JSON.stringify({
          username: email,
          email,
          firstName: displayName,
          enabled: true,
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

    async deleteUser(idpSubject) {
      await transport.request(
        "delete-user",
        `/users/${encodeURIComponent(idpSubject)}`,
        { method: "DELETE" },
      );
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
    async createUser({ email, displayName }) {
      const idpSubject = `in-memory-user-${state.nextSubject++}`;
      state.users.set(idpSubject, {
        email,
        displayName,
        enabled: true,
        otpCredentials: [],
        requiredActions: new Set(),
      });
      return { idpSubject };
    },

    async disableUser(idpSubject) {
      user(idpSubject).enabled = false;
    },

    async deleteUser(idpSubject) {
      user(idpSubject);
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
