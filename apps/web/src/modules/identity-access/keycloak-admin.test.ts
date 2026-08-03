import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";

import {
  createInMemoryKeycloakAdminClient,
  createKeycloakAdminHttpClient,
  keycloakUserAdminFromEnvironment,
  type InMemoryKeycloakAdminState,
} from "./keycloak-admin";

const servers: ReturnType<typeof createServer>[] = [];
const originalEnvironment = {
  baseUrl: process.env.KEYCLOAK_ADMIN_BASE_URL,
  clientId: process.env.KEYCLOAK_ADMIN_CLIENT_ID,
  clientSecret: process.env.KEYCLOAK_ADMIN_CLIENT_SECRET,
  realm: process.env.KEYCLOAK_REALM,
};

function restoreEnvironment(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
  restoreEnvironment("KEYCLOAK_ADMIN_BASE_URL", originalEnvironment.baseUrl);
  restoreEnvironment("KEYCLOAK_ADMIN_CLIENT_ID", originalEnvironment.clientId);
  restoreEnvironment("KEYCLOAK_ADMIN_CLIENT_SECRET", originalEnvironment.clientSecret);
  restoreEnvironment("KEYCLOAK_REALM", originalEnvironment.realm);
});

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function clientFor(handler: (request: Parameters<RequestListener>[0], response: Parameters<RequestListener>[1]) => void) {
  const baseUrl = await listen((request, response) => {
    if (request.url?.endsWith("/protocol/openid-connect/token")) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ access_token: "token", expires_in: 60 }));
      return;
    }
    handler(request, response);
  });
  return createKeycloakAdminHttpClient({ baseUrl, realm: "contract", clientId: "client", clientSecret: "secret", now: () => 0 });
}

describe("Keycloak admin HTTP response validation", () => {
  test("requires both environment credentials", () => {
    delete process.env.KEYCLOAK_ADMIN_BASE_URL;
    delete process.env.KEYCLOAK_ADMIN_CLIENT_SECRET;
    expect(() => keycloakUserAdminFromEnvironment()).toThrowError("Keycloak user-administration service is not configured");
    process.env.KEYCLOAK_ADMIN_BASE_URL = "http://keycloak";
    expect(() => keycloakUserAdminFromEnvironment()).toThrowError("Keycloak user-administration service is not configured");
    delete process.env.KEYCLOAK_ADMIN_BASE_URL;
    process.env.KEYCLOAK_ADMIN_CLIENT_SECRET = "secret";
    expect(() => keycloakUserAdminFromEnvironment()).toThrowError("Keycloak user-administration service is not configured");
  });

  test.each([
    ["defaults", undefined, undefined, "/realms/corporativo/protocol/openid-connect/token", "client_id=smp-keycloak-admin&client_secret=secret&grant_type=client_credentials"],
    ["overrides", "custom realm", "custom client", "/realms/custom%20realm/protocol/openid-connect/token", "client_id=custom+client&client_secret=secret&grant_type=client_credentials"],
  ])("uses environment %s for the real transport", async (_case, realm, clientId, expectedUrl, expectedBody) => {
    const tokenRequests: Array<{ url: string | undefined; body: string }> = [];
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => { body += chunk; });
      request.on("end", () => {
        if (request.url?.includes("/protocol/openid-connect/token")) {
          tokenRequests.push({ url: request.url, body });
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ access_token: "token", expires_in: 60 }));
        } else {
          response.statusCode = 204;
          response.end();
        }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    process.env.KEYCLOAK_ADMIN_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.KEYCLOAK_ADMIN_CLIENT_SECRET = "secret";
    restoreEnvironment("KEYCLOAK_REALM", realm);
    restoreEnvironment("KEYCLOAK_ADMIN_CLIENT_ID", clientId);

    await keycloakUserAdminFromEnvironment().disableUser("user-1");
    expect(tokenRequests).toEqual([{ url: expectedUrl, body: expectedBody }]);
  });

  test.each([
    ["missing", undefined],
    ["not a URL", "not-a-url"],
    ["wrong realm", "http://keycloak/admin/realms/other/users/user-1"],
    ["wrong prefix", "http://keycloak/api/realms/contract/users/user-1"],
    ["wrong resource", "http://keycloak/admin/realms/contract/groups/user-1"],
    ["extra segment", "http://keycloak/admin/realms/contract/users/user-1/detail"],
    ["blank subject", "http://keycloak/admin/realms/contract/users/%20"],
  ])("rejects a %s create-user Location", async (_case, location) => {
    const admin = await clientFor((_request, response) => {
      response.statusCode = 201;
      if (location !== undefined) response.setHeader("location", location);
      response.end();
    });
    await expect(admin.createUser({ email: "user@example.com", displayName: "User Name" }))
      .rejects.toMatchObject({ operation: "create-user", status: 201 });
  });

  test("decodes an encoded provider subject and sends exact user mutations", async () => {
    const requests: Array<{ method: string | undefined; url: string | undefined; body: string }> = [];
    const admin = await clientFor((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => { body += chunk; });
      request.on("end", () => {
        requests.push({ method: request.method, url: request.url, body });
        if (request.method === "POST") {
          response.statusCode = 201;
          response.setHeader("location", "http://keycloak/admin/realms/contract/users/subject%20%C3%B1");
        } else response.statusCode = 204;
        response.end();
      });
    });

    await expect(admin.createUser({ email: "user@example.com", displayName: "User Name" })).resolves.toEqual({ idpSubject: "subject ñ" });
    await admin.disableUser("subject / ñ");
    await admin.deleteUser("subject / ñ");
    await admin.removeOtpCredential("subject / ñ", "otp / ñ");

    expect(requests).toEqual([
      { method: "POST", url: "/admin/realms/contract/users", body: "{\"username\":\"user@example.com\",\"email\":\"user@example.com\",\"firstName\":\"User Name\",\"enabled\":true}" },
      { method: "PUT", url: "/admin/realms/contract/users/subject%20%2F%20%C3%B1", body: "{\"enabled\":false}" },
      { method: "DELETE", url: "/admin/realms/contract/users/subject%20%2F%20%C3%B1", body: "" },
      { method: "DELETE", url: "/admin/realms/contract/users/subject%20%2F%20%C3%B1/credentials/otp%20%2F%20%C3%B1", body: "" },
    ]);
  });

  test.each([
    ["non-array", {}],
    ["null entry", [null]],
    ["array entry", [[]]],
    ["missing id", [{ type: "otp" }]],
    ["non-string id", [{ id: 7, type: "otp" }]],
    ["blank id", [{ id: " ", type: "otp" }]],
    ["missing type", [{ id: "otp-1" }]],
    ["non-string type", [{ id: "otp-1", type: 7 }]],
    ["blank type", [{ id: "otp-1", type: " " }]],
  ])("rejects malformed credentials: %s", async (_case, payload) => {
    const admin = await clientFor((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(payload));
    });
    await expect(admin.listOtpCredentials("user-1"))
      .rejects.toMatchObject({ operation: "list-otp-credentials", status: 200 });
  });

  test("returns only exact otp credentials without trimming provider identifiers", async () => {
    const admin = await clientFor((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify([
        { id: " otp-1 ", type: "otp" },
        { id: "password-1", type: "password" },
        { id: "otp-case", type: "OTP" },
      ]));
    });
    await expect(admin.listOtpCredentials("user-1")).resolves.toEqual([{ id: " otp-1 " }]);
  });

  test.each([
    ["null payload", null],
    ["array payload", []],
    ["missing actions", {}],
    ["non-array actions", { requiredActions: "VERIFY_EMAIL" }],
    ["non-string action", { requiredActions: [7] }],
    ["blank action", { requiredActions: [" "] }],
  ])("rejects malformed required actions: %s", async (_case, payload) => {
    const admin = await clientFor((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(payload));
    });
    await expect(admin.addRequiredAction("user-1", "CONFIGURE_TOTP"))
      .rejects.toMatchObject({ operation: "read-required-actions", status: 200 });
  });

  test("preserves ordered actions and de-duplicates CONFIGURE_TOTP", async () => {
    const requests: Array<{ method: string | undefined; body: string }> = [];
    const admin = await clientFor((request, response) => {
      if (request.method === "GET") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ requiredActions: ["VERIFY_EMAIL", "CONFIGURE_TOTP", "CONFIGURE_TOTP"] }));
        return;
      }
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => { body += chunk; });
      request.on("end", () => {
        requests.push({ method: request.method, body });
        response.statusCode = 204;
        response.end();
      });
    });
    await admin.addRequiredAction("user-1", "CONFIGURE_TOTP");
    expect(requests).toEqual([{ method: "PUT", body: "{\"requiredActions\":[\"VERIFY_EMAIL\",\"CONFIGURE_TOTP\"]}" }]);
  });
});

describe("in-memory Keycloak admin failure and state contracts", () => {
  test("uses deterministic default state and rejects every operation for an unknown subject", async () => {
    const admin = createInMemoryKeycloakAdminClient();
    await expect(admin.createUser({ email: "one@example.com", displayName: "One" })).resolves.toEqual({ idpSubject: "in-memory-user-1" });
    await expect(admin.createUser({ email: "two@example.com", displayName: "Two" })).resolves.toEqual({ idpSubject: "in-memory-user-2" });
    for (const operation of [
      admin.disableUser("missing"),
      admin.deleteUser("missing"),
      admin.listOtpCredentials("missing"),
      admin.removeOtpCredential("missing", "otp"),
      admin.addRequiredAction("missing", "CONFIGURE_TOTP"),
    ]) {
      await expect(operation).rejects.toEqual(expect.objectContaining({ name: "KeycloakAdminError", operation: "resolve-in-memory-user", status: 404 }));
    }
  });

  test("mutates only the selected credential and keeps exact created values", async () => {
    const state: InMemoryKeycloakAdminState = { nextSubject: 8, users: new Map() };
    const admin = createInMemoryKeycloakAdminClient(state);
    const created = await admin.createUser({ email: " exact@example.com ", displayName: " Exact Name " });
    expect(created).toEqual({ idpSubject: "in-memory-user-8" });
    expect(state.nextSubject).toBe(9);
    expect(state.users.get(created.idpSubject)).toEqual({ email: " exact@example.com ", displayName: " Exact Name ", enabled: true, otpCredentials: [], requiredActions: new Set() });
    state.users.get(created.idpSubject)!.otpCredentials = [{ id: "otp-1" }, { id: "otp-2" }];

    await admin.removeOtpCredential(created.idpSubject, "otp-1");
    expect(await admin.listOtpCredentials(created.idpSubject)).toEqual([{ id: "otp-2" }]);
    await admin.disableUser(created.idpSubject);
    expect(state.users.get(created.idpSubject)?.enabled).toBe(false);
    await admin.addRequiredAction(created.idpSubject, "CONFIGURE_TOTP");
    expect(state.users.get(created.idpSubject)?.requiredActions).toEqual(new Set(["CONFIGURE_TOTP"]));
    await admin.deleteUser(created.idpSubject);
    expect(state.users.has(created.idpSubject)).toBe(false);
  });
});
