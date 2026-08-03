import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MatchersV3,
  PactV3,
  type V3Request,
  type V3Response,
} from "@pact-foundation/pact";
import { afterAll, describe, expect, test } from "vitest";

import {
  createInMemoryKeycloakAdminClient,
  createKeycloakAdminHttpClient,
  type InMemoryKeycloakAdminState,
} from "./keycloak-admin";
import { KeycloakAdminError } from "../../lib/auth/keycloak-admin-transport";

const { like } = MatchersV3;
const pactDirectory = mkdtempSync(join(tmpdir(), "ledger-keycloak-pacts-"));
const contractPath = join(
  pactDirectory,
  "ledger-identity-access-keycloak-admin-api.json",
);
const realm = "contract";
const clientId = "ledger-contract-client";
const clientSecret = "ledger-contract-secret";
const idpSubject = "user-contract-1";

async function executeContract(input: {
  description: string;
  request: V3Request;
  response: V3Response;
  additionalInteractions?: Array<{
    description: string;
    request: V3Request;
    response: V3Response;
  }>;
  exercise: (baseUrl: string) => Promise<void>;
}): Promise<void> {
  const provider = new PactV3({
    consumer: "ledger-identity-access",
    provider: "keycloak-admin-api",
    dir: pactDirectory,
    logLevel: "error",
  });
  provider.addInteraction({
    uponReceiving: `issues a service token for ${input.description}`,
    withRequest: {
      method: "POST",
      path: `/realms/${realm}/protocol/openid-connect/token`,
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: `client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
    },
    willRespondWith: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { access_token: like("contract-access-token"), expires_in: like(60) },
    },
  });
  provider.addInteraction({
    uponReceiving: input.description,
    withRequest: {
      ...input.request,
      headers: {
        authorization: "Bearer contract-access-token",
        ...input.request.headers,
      },
    },
    willRespondWith: input.response,
  });
  for (const interaction of input.additionalInteractions ?? []) {
    provider.addInteraction({
      uponReceiving: interaction.description,
      withRequest: {
        ...interaction.request,
        headers: {
          authorization: "Bearer contract-access-token",
          ...interaction.request.headers,
        },
      },
      willRespondWith: interaction.response,
    });
  }

  await provider.executeTest(async ({ url }) => {
    await input.exercise(url);
  });
}

async function executeTokenContract(input: {
  description: string;
  response: V3Response;
  exercise: (baseUrl: string) => Promise<void>;
}): Promise<void> {
  const provider = new PactV3({
    consumer: "ledger-identity-access",
    provider: "keycloak-admin-api",
    dir: pactDirectory,
    logLevel: "error",
  });
  provider.addInteraction({
    uponReceiving: input.description,
    withRequest: {
      method: "POST",
      path: `/realms/${realm}/protocol/openid-connect/token`,
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: `client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
    },
    willRespondWith: input.response,
  });
  await provider.executeTest(async ({ url }) => input.exercise(url));
}

async function rejected(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

function client(baseUrl: string) {
  return createKeycloakAdminHttpClient({
    baseUrl,
    realm,
    clientId,
    clientSecret,
  });
}

describe("Keycloak Admin API consumer contract", () => {
  test("creates a user and returns the provider subject", async () => {
    await executeContract({
      description: "creates an enabled Keycloak user",
      request: {
        method: "POST",
        path: `/admin/realms/${realm}/users`,
        headers: { "content-type": "application/json" },
        body: {
          username: "admin@example.com",
          email: "admin@example.com",
          firstName: "Admin Example",
          enabled: true,
        },
      },
      response: {
        status: 201,
        headers: {
          location: `http://keycloak.test/admin/realms/${realm}/users/${idpSubject}`,
        },
      },
      exercise: async (baseUrl) => {
        await expect(
          client(baseUrl).createUser({
            email: "admin@example.com",
            displayName: "Admin Example",
          }),
        ).resolves.toEqual({ idpSubject });
      },
    });
  });

  test("disables a user", async () => {
    await executeContract({
      description: "disables a Keycloak user",
      request: {
        method: "PUT",
        path: `/admin/realms/${realm}/users/${idpSubject}`,
        headers: { "content-type": "application/json" },
        body: { enabled: false },
      },
      response: { status: 204 },
      exercise: async (baseUrl) => {
        await client(baseUrl).disableUser(idpSubject);
      },
    });
  });

  test("deletes a newly created user for Ledger persistence compensation", async () => {
    await executeContract({
      description: "deletes a Keycloak user",
      request: {
        method: "DELETE",
        path: `/admin/realms/${realm}/users/${idpSubject}`,
      },
      response: { status: 204 },
      exercise: async (baseUrl) => {
        await client(baseUrl).deleteUser(idpSubject);
      },
    });
  });

  test("lists only OTP credentials", async () => {
    await executeContract({
      description: "lists a user's Keycloak credentials",
      request: {
        method: "GET",
        path: `/admin/realms/${realm}/users/${idpSubject}/credentials`,
      },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: [
          { id: like("otp-contract-1"), type: "otp" },
          { id: like("password-contract-1"), type: "password" },
        ],
      },
      exercise: async (baseUrl) => {
        await expect(
          client(baseUrl).listOtpCredentials(idpSubject),
        ).resolves.toEqual([{ id: "otp-contract-1" }]);
      },
    });
  });

  test("removes an OTP credential", async () => {
    await executeContract({
      description: "removes a user's Keycloak OTP credential",
      request: {
        method: "DELETE",
        path: `/admin/realms/${realm}/users/${idpSubject}/credentials/otp-contract-1`,
      },
      response: { status: 204 },
      exercise: async (baseUrl) => {
        await client(baseUrl).removeOtpCredential(
          idpSubject,
          "otp-contract-1",
        );
      },
    });
  });

  test("adds the configure-TOTP required action", async () => {
    await executeContract({
      description: "reads a user's existing Keycloak required actions",
      request: {
        method: "GET",
        path: `/admin/realms/${realm}/users/${idpSubject}`,
      },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: {
          id: idpSubject,
          username: "admin@example.com",
          email: "admin@example.com",
          enabled: true,
          requiredActions: ["VERIFY_EMAIL", "CONFIGURE_TOTP"],
        },
      },
      additionalInteractions: [
        {
          description: "requires TOTP configuration for a Keycloak user",
          request: {
            method: "PUT",
            path: `/admin/realms/${realm}/users/${idpSubject}`,
            headers: { "content-type": "application/json" },
            body: {
              requiredActions: ["VERIFY_EMAIL", "CONFIGURE_TOTP"],
            },
          },
          response: { status: 204 },
        },
      ],
      exercise: async (baseUrl) => {
        await client(baseUrl).addRequiredAction(
          idpSubject,
          "CONFIGURE_TOTP",
        );
      },
    });
  });

  test("rejects a null token payload with a sanitized error", async () => {
    await executeTokenContract({
      description: "returns a malformed null service-token payload",
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: null,
      },
      exercise: async (baseUrl) => {
        const error = await rejected(client(baseUrl).disableUser(idpSubject));
        expect(error).toBeInstanceOf(KeycloakAdminError);
        expect(error).toMatchObject({
          operation: "obtain-service-token",
          status: 200,
        });
        expect(String(error)).not.toContain(clientSecret);
      },
    });
  });

  test("rejects a blank access token before an admin request", async () => {
    await executeTokenContract({
      description: "returns a blank Keycloak service token",
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { access_token: "   ", expires_in: 60 },
      },
      exercise: async (baseUrl) => {
        const error = await rejected(client(baseUrl).disableUser(idpSubject));
        expect(error).toBeInstanceOf(KeycloakAdminError);
        expect(error).toMatchObject({
          operation: "obtain-service-token",
          status: 200,
        });
      },
    });
  });

  test("rejects malformed credential entries instead of dropping them", async () => {
    await executeContract({
      description: "returns a malformed Keycloak credential entry",
      request: {
        method: "GET",
        path: `/admin/realms/${realm}/users/${idpSubject}/credentials`,
      },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: [null],
      },
      exercise: async (baseUrl) => {
        const error = await rejected(
          client(baseUrl).listOtpCredentials(idpSubject),
        );
        expect(error).toBeInstanceOf(KeycloakAdminError);
        expect(error).toMatchObject({
          operation: "list-otp-credentials",
          status: 200,
        });
        expect(String(error)).not.toContain("admin@example.com");
      },
    });
  });

  test("rejects a non-Keycloak Location without returning a forged subject", async () => {
    await executeContract({
      description: "returns a malformed Keycloak user Location",
      request: {
        method: "POST",
        path: `/admin/realms/${realm}/users`,
        headers: { "content-type": "application/json" },
        body: {
          username: "admin@example.com",
          email: "admin@example.com",
          firstName: "Admin Example",
          enabled: true,
        },
      },
      response: {
        status: 201,
        headers: { location: "not-a-keycloak-location/forged-subject" },
      },
      exercise: async (baseUrl) => {
        const error = await rejected(
          client(baseUrl).createUser({
            email: "admin@example.com",
            displayName: "Admin Example",
          }),
        );
        expect(error).toBeInstanceOf(KeycloakAdminError);
        expect(error).toMatchObject({ operation: "create-user", status: 201 });
        expect(String(error)).not.toContain("admin@example.com");
      },
    });
  });

  test("redacts provider bodies and credentials from non-success errors", async () => {
    await executeTokenContract({
      description: "rejects a Keycloak service-token request",
      response: {
        status: 401,
        headers: { "content-type": "application/json" },
        body: {
          error: "invalid_client",
          error_description: `${clientSecret}: admin@example.com`,
        },
      },
      exercise: async (baseUrl) => {
        const error = await rejected(client(baseUrl).disableUser(idpSubject));
        expect(error).toBeInstanceOf(KeycloakAdminError);
        expect(error).toMatchObject({
          operation: "obtain-service-token",
          status: 401,
        });
        expect(JSON.stringify(error)).not.toContain(clientSecret);
        expect(String(error)).not.toContain("admin@example.com");
        expect(String(error)).not.toContain("invalid_client");
      },
    });
  });
});

describe("in-memory Keycloak admin client", () => {
  test("implements user, credential, and required-action state transitions", async () => {
    const state: InMemoryKeycloakAdminState = {
      nextSubject: 1,
      users: new Map([
        [
          "seed-user",
          {
            email: "seed@example.com",
            displayName: "Seed User",
            enabled: true,
            otpCredentials: [{ id: "otp-seed-1" }],
            requiredActions: new Set(),
          },
        ],
      ]),
    };
    const inMemoryClient = createInMemoryKeycloakAdminClient(state);

    await expect(
      inMemoryClient.createUser({
        email: "new@example.com",
        displayName: "New User",
      }),
    ).resolves.toEqual({ idpSubject: "in-memory-user-1" });
    await inMemoryClient.disableUser("in-memory-user-1");
    await inMemoryClient.deleteUser("in-memory-user-1");
    await expect(
      inMemoryClient.listOtpCredentials("seed-user"),
    ).resolves.toEqual([{ id: "otp-seed-1" }]);
    await inMemoryClient.removeOtpCredential("seed-user", "otp-seed-1");
    await inMemoryClient.addRequiredAction("seed-user", "CONFIGURE_TOTP");

    expect(state.users.has("in-memory-user-1")).toBe(false);
    expect(state.users.get("seed-user")?.otpCredentials).toEqual([]);
    expect(state.users.get("seed-user")?.requiredActions).toEqual(
      new Set(["CONFIGURE_TOTP"]),
    );
  });
});

afterAll(() => {
  const contract = JSON.parse(readFileSync(contractPath, "utf8")) as {
    interactions?: Array<{ description?: string }>;
  };
  const descriptions = new Set(
    contract.interactions?.map(({ description }) => description),
  );
  expect([...descriptions]).toEqual(
    expect.arrayContaining([
        "creates an enabled Keycloak user",
        "disables a Keycloak user",
        "deletes a Keycloak user",
        "lists a user's Keycloak credentials",
        "removes a user's Keycloak OTP credential",
        "requires TOTP configuration for a Keycloak user",
      ]),
  );
  rmSync(pactDirectory, { recursive: true, force: true });
});
