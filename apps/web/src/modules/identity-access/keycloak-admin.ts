import { KeycloakAdminError } from "../../lib/auth/keycloak-admin";

export interface KeycloakAdminClient {
  createUser(input: {
    email: string;
    displayName: string;
  }): Promise<{ idpSubject: string }>;
  disableUser(idpSubject: string): Promise<void>;
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

export interface KeycloakAdminHttpClientOptions {
  readonly baseUrl: string;
  readonly realm: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export function createKeycloakAdminHttpClient({
  baseUrl,
  realm,
  clientId,
  clientSecret,
}: KeycloakAdminHttpClientOptions): KeycloakAdminClient {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const realmPath = encodeURIComponent(realm);

  async function accessToken(): Promise<string> {
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

    let payload: { access_token?: unknown };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      throw new KeycloakAdminError("obtain-service-token", response.status);
    }
    if (typeof payload.access_token !== "string") {
      throw new KeycloakAdminError("obtain-service-token", response.status);
    }
    return payload.access_token;
  }

  async function adminRequest(
    operation: string,
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const token = await accessToken();
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
    if (!response.ok) {
      throw new KeycloakAdminError(operation, response.status);
    }
    return response;
  }

  return {
    async createUser({ email, displayName }) {
      const response = await adminRequest("create-user", "/users", {
        method: "POST",
        body: JSON.stringify({
          username: email,
          email,
          firstName: displayName,
          enabled: true,
        }),
      });
      const location = response.headers.get("location");
      const idpSubject = location?.split("/").at(-1);
      if (!idpSubject) {
        throw new KeycloakAdminError("create-user", response.status);
      }
      return { idpSubject };
    },

    async disableUser(idpSubject) {
      await adminRequest(
        "disable-user",
        `/users/${encodeURIComponent(idpSubject)}`,
        { method: "PUT", body: JSON.stringify({ enabled: false }) },
      );
    },

    async listOtpCredentials(idpSubject) {
      const response = await adminRequest(
        "list-otp-credentials",
        `/users/${encodeURIComponent(idpSubject)}/credentials`,
      );
      let credentials: Array<{ id?: unknown; type?: unknown }>;
      try {
        credentials = (await response.json()) as typeof credentials;
      } catch {
        throw new KeycloakAdminError(
          "list-otp-credentials",
          response.status,
        );
      }
      if (!Array.isArray(credentials)) {
        throw new KeycloakAdminError(
          "list-otp-credentials",
          response.status,
        );
      }
      return credentials.flatMap((credential) =>
        credential.type === "otp" && typeof credential.id === "string"
          ? [{ id: credential.id }]
          : [],
      );
    },

    async removeOtpCredential(idpSubject, credentialId) {
      await adminRequest(
        "remove-otp-credential",
        `/users/${encodeURIComponent(idpSubject)}/credentials/${encodeURIComponent(credentialId)}`,
        { method: "DELETE" },
      );
    },

    async addRequiredAction(idpSubject, action) {
      await adminRequest(
        "add-required-action",
        `/users/${encodeURIComponent(idpSubject)}`,
        {
          method: "PUT",
          body: JSON.stringify({ requiredActions: [action] }),
        },
      );
    },
  };
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
