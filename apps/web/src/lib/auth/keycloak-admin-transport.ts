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

export interface KeycloakAdminTransportOptions {
  readonly baseUrl: string;
  readonly realm: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly now?: () => number;
}

export interface KeycloakAdminTransport {
  request(
    operation: string,
    path: string,
    init?: RequestInit,
  ): Promise<Response>;
}

type TokenState = {
  accessToken: string;
  expiresAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readKeycloakJson(
  response: Response,
  operation: string,
): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new KeycloakAdminError(operation, response.status);
  }
}

export function createKeycloakAdminTransport({
  baseUrl,
  realm,
  clientId,
  clientSecret,
  now = Date.now,
}: KeycloakAdminTransportOptions): KeycloakAdminTransport {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const realmPath = encodeURIComponent(realm);
  let tokenState: TokenState | null = null;
  let tokenRequest: Promise<string> | null = null;

  async function accessToken(forceRefresh = false): Promise<string> {
    if (
      !forceRefresh &&
      tokenState &&
      tokenState.expiresAt > now() + 5_000
    ) {
      return tokenState.accessToken;
    }

    if (tokenRequest) return tokenRequest;

    const request = (async () => {

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

    const payload = await readKeycloakJson(response, "obtain-service-token");
    if (!isRecord(payload)) {
      throw new KeycloakAdminError("obtain-service-token", response.status);
    }
    const rawAccessToken = payload.access_token;
    const expiresIn = payload.expires_in;
    if (
      typeof rawAccessToken !== "string" ||
      rawAccessToken.trim().length === 0 ||
      typeof expiresIn !== "number" ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0
    ) {
      throw new KeycloakAdminError("obtain-service-token", response.status);
    }
    tokenState = {
      accessToken: rawAccessToken.trim(),
      expiresAt: now() + expiresIn * 1_000,
    };
    return tokenState.accessToken;
    })();
    tokenRequest = request;
    try {
      return await request;
    } finally {
      if (tokenRequest === request) tokenRequest = null;
    }
  }

  return {
    async request(operation, path, init = {}) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const token = await accessToken(attempt === 1);
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
        if (response.status === 401 && attempt === 0) {
          tokenState = null;
          continue;
        }
        if (!response.ok) {
          throw new KeycloakAdminError(operation, response.status);
        }
        return response;
      }
      throw new KeycloakAdminError(operation, 401);
    },
  };
}
