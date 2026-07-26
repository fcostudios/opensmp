import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createKeycloakAdminClient,
  type KeycloakSecurityEvent,
} from "./keycloak-admin";

const execFileAsync = promisify(execFile);
const image = "quay.io/keycloak/keycloak:26.5";
const bootstrapUser = "us004-bootstrap";
const bootstrapPassword = "us004-bootstrap-password";
const webSecret = "us004-test-web-secret";
const serviceSecret = "us004-test-admin-secret";

let containerName: string;
let baseUrl: string;
let candidateId: string;

async function docker(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("docker", args, {
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

async function resolveKeycloakBaseUrl(): Promise<string> {
  const binding = await docker(["port", containerName, "8080/tcp"]);
  const port = binding.match(/:(\d+)$/)?.[1];
  if (!port) throw new Error("Docker did not publish the Keycloak HTTP port");
  return `http://127.0.0.1:${port}`;
}

async function waitForKeycloak(): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/realms/corporativo`, {
        headers: { Connection: "close" },
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {
      // The real container is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  const logs = await docker(["logs", "--tail", "80", containerName]).catch(
    (error: unknown) => `unable to read container logs: ${String(error)}`,
  );
  throw new Error(
    `Keycloak did not become ready before the integration deadline\n${logs}`,
  );
}

async function token(
  realm: "master" | "corporativo",
  clientId: string,
  clientSecret: string | null,
  username?: string,
  password?: string,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: username ? "password" : "client_credentials",
  });
  if (clientSecret) body.set("client_secret", clientSecret);
  if (username) body.set("username", username);
  if (password) body.set("password", password);
  const response = await fetch(
    `${baseUrl}/realms/${realm}/protocol/openid-connect/token`,
    { method: "POST", body },
  );
  const payload = (await response.json()) as { access_token?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(`Test bootstrap token request failed with ${response.status}`);
  }
  return payload.access_token;
}

async function masterRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const accessToken = await token(
    "master",
    "admin-cli",
    null,
    bootstrapUser,
    bootstrapPassword,
  );
  return fetch(`${baseUrl}/admin/realms/corporativo${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

beforeAll(async () => {
  containerName = `ledger-us004-${randomUUID()}`;
  const realmPath = resolve(
    import.meta.dirname,
    "../../../../../infra/keycloak/realm-corporativo.json",
  );
  await docker([
    "run",
    "--detach",
    "--name",
    containerName,
    "--publish",
    "127.0.0.1::8080",
    "--env",
    `KC_BOOTSTRAP_ADMIN_USERNAME=${bootstrapUser}`,
    "--env",
    `KC_BOOTSTRAP_ADMIN_PASSWORD=${bootstrapPassword}`,
    "--env",
    `SMP_WEB_CLIENT_SECRET=${webSecret}`,
    "--env",
    `SMP_KEYCLOAK_ADMIN_CLIENT_SECRET=${serviceSecret}`,
    "--env",
    "LEDGER_PUBLIC_URL=http://localhost:3000",
    "--volume",
    `${realmPath}:/opt/keycloak/data/import/realm-corporativo.json:ro`,
    image,
    "start-dev",
    "--import-realm",
  ]);
  baseUrl = await resolveKeycloakBaseUrl();
  await waitForKeycloak();

  const userResponse = await masterRequest("/users", {
    method: "POST",
    body: JSON.stringify({
      username: "admin-candidate",
      email: "admin-candidate@corporativo.example",
      emailVerified: true,
      enabled: true,
      credentials: [
        { type: "password", value: "candidate-password", temporary: false },
      ],
    }),
  });
  expect(userResponse.status).toBe(201);
  candidateId = userResponse.headers.get("location")?.split("/").at(-1) ?? "";
  expect(candidateId).not.toBe("");

  const probeClient = await masterRequest("/clients", {
    method: "POST",
    body: JSON.stringify({
      clientId: "us004-event-probe",
      enabled: true,
      publicClient: true,
      standardFlowEnabled: false,
      directAccessGrantsEnabled: true,
    }),
  });
  expect(probeClient.status).toBe(201);
}, 150_000);

afterAll(async () => {
  if (containerName) {
    await docker(["rm", "--force", containerName]);
  }
}, 30_000);

describe("Keycloak admin service seam against real Keycloak", () => {
  test("imports environment-injected client secrets and no production fixture users", async () => {
    const clientsResponse = await masterRequest("/clients?clientId=smp-web");
    expect(clientsResponse.status).toBe(200);
    const clients = (await clientsResponse.json()) as Array<{ id: string }>;
    expect(clients).toHaveLength(1);
    const secretResponse = await masterRequest(
      `/clients/${clients[0]?.id}/client-secret`,
    );
    expect(secretResponse.status).toBe(200);
    await expect(secretResponse.json()).resolves.toMatchObject({
      value: webSecret,
    });

    const usersResponse = await masterRequest("/users?max=100");
    const users = (await usersResponse.json()) as Array<{
      serviceAccountClientId?: string;
      username: string;
    }>;
    expect(
      users.filter(({ serviceAccountClientId }) => !serviceAccountClientId),
    ).toEqual([
      expect.objectContaining({ username: "admin-candidate" }),
    ]);
  });

  test("adds and removes platform-admin membership with the least-privilege service account", async () => {
    const client = createKeycloakAdminClient({
      baseUrl,
      realm: "corporativo",
      clientId: "smp-keycloak-admin",
      clientSecret: serviceSecret,
    });

    await token(
      "corporativo",
      "us004-event-probe",
      null,
      "admin-candidate",
      "candidate-password",
    );
    const sessionsBeforePromotion = await masterRequest(
      `/users/${candidateId}/sessions`,
    );
    expect(
      (await sessionsBeforePromotion.json()) as unknown[],
    ).not.toHaveLength(0);

    await client.addUserToPlatformAdmin(candidateId);
    let groupsResponse = await masterRequest(`/users/${candidateId}/groups`);
    await expect(groupsResponse.json()).resolves.toEqual([
      expect.objectContaining({ path: "/platform-admin" }),
    ]);
    const sessionsAfterPromotion = await masterRequest(
      `/users/${candidateId}/sessions`,
    );
    await expect(sessionsAfterPromotion.json()).resolves.toEqual([]);

    await client.removeUserFromPlatformAdmin(candidateId);
    groupsResponse = await masterRequest(`/users/${candidateId}/groups`);
    await expect(groupsResponse.json()).resolves.toEqual([]);

    const serviceToken = await token(
      "corporativo",
      "smp-keycloak-admin",
      serviceSecret,
    );
    const unrelatedPrivilege = await fetch(
      `${baseUrl}/admin/realms/corporativo/clients`,
      { headers: { Authorization: `Bearer ${serviceToken}` } },
    );
    expect(unrelatedPrivilege.status).toBe(403);
  });

  test("redacts secrets and provider response payloads from admin failures", async () => {
    const leakedSecret = "must-never-appear-in-errors";
    const client = createKeycloakAdminClient({
      baseUrl,
      realm: "corporativo",
      clientId: "smp-keycloak-admin",
      clientSecret: leakedSecret,
    });

    const failure = await client
      .disableUser(candidateId)
      .then(() => null)
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      operation: "obtain-service-token",
      status: 401,
    });
    expect(JSON.stringify(failure)).not.toContain(leakedSecret);
    expect(String(failure)).not.toContain("invalid_client");
  });

  test("disables a user and revokes all of that user's real sessions", async () => {
    const client = createKeycloakAdminClient({
      baseUrl,
      realm: "corporativo",
      clientId: "smp-keycloak-admin",
      clientSecret: serviceSecret,
    });
    await token(
      "corporativo",
      "us004-event-probe",
      null,
      "admin-candidate",
      "candidate-password",
    );
    const sessionsBefore = await masterRequest(`/users/${candidateId}/sessions`);
    expect((await sessionsBefore.json()) as unknown[]).not.toHaveLength(0);

    await client.revokeSessions(candidateId);
    const sessionsAfter = await masterRequest(`/users/${candidateId}/sessions`);
    await expect(sessionsAfter.json()).resolves.toEqual([]);

    await client.disableUser(candidateId);
    const userResponse = await masterRequest(`/users/${candidateId}`);
    await expect(userResponse.json()).resolves.toMatchObject({ enabled: false });
    const denied = await fetch(
      `${baseUrl}/realms/corporativo/protocol/openid-connect/token`,
      {
        method: "POST",
        body: new URLSearchParams({
          client_id: "us004-event-probe",
          grant_type: "password",
          username: "admin-candidate",
          password: "candidate-password",
        }),
      },
    );
    expect(denied.status).toBe(400);
  });

  test("queries retained LOGIN_ERROR evidence after a real Keycloak restart", async () => {
    const enableCandidate = await masterRequest(`/users/${candidateId}`, {
      method: "PUT",
      body: JSON.stringify({ enabled: true }),
    });
    expect(enableCandidate.status).toBe(204);

    const wrongPassword = await fetch(
      `${baseUrl}/realms/corporativo/protocol/openid-connect/token`,
      {
        method: "POST",
        body: new URLSearchParams({
          client_id: "us004-event-probe",
          grant_type: "password",
          username: "admin-candidate",
          password: "definitely-wrong",
        }),
      },
    );
    expect(wrongPassword.status).toBeGreaterThanOrEqual(400);

    const client = createKeycloakAdminClient({
      baseUrl,
      realm: "corporativo",
      clientId: "smp-keycloak-admin",
      clientSecret: serviceSecret,
    });
    const beforeRestart = await client.listSecurityEvents({
      types: ["LOGIN_ERROR"],
      max: 20,
    });
    expect(beforeRestart).toEqual(
      expect.arrayContaining<KeycloakSecurityEvent>([
        expect.objectContaining({
          type: "LOGIN_ERROR",
          clientId: "us004-event-probe",
          error: "invalid_user_credentials",
        }),
      ]),
    );

    await docker(["restart", containerName]);
    baseUrl = await resolveKeycloakBaseUrl();
    await waitForKeycloak();
    const restartedClient = createKeycloakAdminClient({
      baseUrl,
      realm: "corporativo",
      clientId: "smp-keycloak-admin",
      clientSecret: serviceSecret,
    });
    const afterRestart = await restartedClient.listSecurityEvents({
      types: ["LOGIN_ERROR"],
      max: 20,
    });
    expect(afterRestart).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "LOGIN_ERROR",
          clientId: "us004-event-probe",
          error: "invalid_user_credentials",
        }),
      ]),
    );
  }, 150_000);
});
