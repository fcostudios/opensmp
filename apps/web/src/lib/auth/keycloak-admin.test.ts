import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";

import { createKeycloakAdminClient, keycloakAdminFromEnvironment } from "./keycloak-admin";

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

async function clientFor(handler: RequestListener) {
  const server = createServer((request, response) => {
    if (request.url?.endsWith("/protocol/openid-connect/token")) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ access_token: "token", expires_in: 60 }));
      return;
    }
    handler(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return createKeycloakAdminClient({ baseUrl: `http://127.0.0.1:${port}`, realm: "contract", clientId: "client", clientSecret: "secret" });
}

describe("platform-administrator Keycloak client", () => {
  test("requires both environment credentials", () => {
    delete process.env.KEYCLOAK_ADMIN_BASE_URL;
    delete process.env.KEYCLOAK_ADMIN_CLIENT_SECRET;
    expect(() => keycloakAdminFromEnvironment()).toThrowError("KEYCLOAK_ADMIN_BASE_URL and KEYCLOAK_ADMIN_CLIENT_SECRET are required");
    process.env.KEYCLOAK_ADMIN_BASE_URL = "http://keycloak";
    expect(() => keycloakAdminFromEnvironment()).toThrowError("KEYCLOAK_ADMIN_BASE_URL and KEYCLOAK_ADMIN_CLIENT_SECRET are required");
    delete process.env.KEYCLOAK_ADMIN_BASE_URL;
    process.env.KEYCLOAK_ADMIN_CLIENT_SECRET = "secret";
    expect(() => keycloakAdminFromEnvironment()).toThrowError("KEYCLOAK_ADMIN_BASE_URL and KEYCLOAK_ADMIN_CLIENT_SECRET are required");
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

    await keycloakAdminFromEnvironment().revokeSessions("user-1");
    expect(tokenRequests).toEqual([{ url: expectedUrl, body: expectedBody }]);
  });

  test("resolves and caches the exact group while issuing every membership and session mutation", async () => {
    const requests: Array<{ method: string | undefined; url: string | undefined; body: string }> = [];
    const client = await clientFor((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => { body += chunk; });
      request.on("end", () => {
        requests.push({ method: request.method, url: request.url, body });
        if (request.url?.endsWith("/group-by-path/platform-admin")) {
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ id: " group / ñ " }));
        } else {
          response.statusCode = 204;
          response.end();
        }
      });
    });

    await client.addUserToPlatformAdmin("user / ñ");
    await client.removeUserFromPlatformAdmin("user / ñ");
    await client.disableUser("user / ñ");
    await client.revokeSessions("user / ñ");

    expect(requests).toEqual([
      { method: "GET", url: "/admin/realms/contract/group-by-path/platform-admin", body: "" },
      { method: "PUT", url: "/admin/realms/contract/users/user%20%2F%20%C3%B1/groups/%20group%20%2F%20%C3%B1%20", body: "" },
      { method: "POST", url: "/admin/realms/contract/users/user%20%2F%20%C3%B1/logout", body: "" },
      { method: "DELETE", url: "/admin/realms/contract/users/user%20%2F%20%C3%B1/groups/%20group%20%2F%20%C3%B1%20", body: "" },
      { method: "PUT", url: "/admin/realms/contract/users/user%20%2F%20%C3%B1", body: "{\"enabled\":false}" },
      { method: "POST", url: "/admin/realms/contract/users/user%20%2F%20%C3%B1/logout", body: "" },
    ]);
  });

  test.each([
    ["null", null],
    ["array", []],
    ["string", "group"],
    ["missing id", {}],
    ["non-string id", { id: 7 }],
    ["blank id", { id: " " }],
  ])("rejects a malformed platform-admin group: %s", async (_case, payload) => {
    const client = await clientFor((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(payload));
    });
    await expect(client.addUserToPlatformAdmin("user-1"))
      .rejects.toMatchObject({ operation: "resolve-platform-admin-group", status: 200 });
  });

  test.each([
    ["non-array", {}],
    ["null event", [null]],
    ["array event", [[]]],
    ["missing type", [{ time: 1 }]],
    ["non-string type", [{ type: 7, time: 1 }]],
    ["missing time", [{ type: "LOGIN_ERROR" }]],
    ["non-number time", [{ type: "LOGIN_ERROR", time: "1" }]],
  ])("rejects malformed security events: %s", async (_case, payload) => {
    const client = await clientFor((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(payload));
    });
    await expect(client.listSecurityEvents({ types: ["LOGIN_ERROR"], max: 20 }))
      .rejects.toMatchObject({ operation: "query-security-events", status: 200 });
  });

  test("encodes the ordered event query and normalizes optional provider fields", async () => {
    const urls: Array<string | undefined> = [];
    const client = await clientFor((request, response) => {
      urls.push(request.url);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify([
        { type: "LOGIN_ERROR", time: 123, clientId: "web", error: "invalid", userId: "user-1" },
        { type: "CODE_TO_TOKEN_ERROR", time: 456, clientId: null, error: 7, userId: undefined },
      ]));
    });

    await expect(client.listSecurityEvents({ types: ["LOGIN ERROR", "CODE_TO_TOKEN_ERROR"], max: 27 })).resolves.toEqual([
      { type: "LOGIN_ERROR", time: 123, clientId: "web", error: "invalid", userId: "user-1" },
      { type: "CODE_TO_TOKEN_ERROR", time: 456, clientId: null, error: null, userId: null },
    ]);
    expect(urls).toEqual(["/admin/realms/contract/events?max=27&type=LOGIN+ERROR&type=CODE_TO_TOKEN_ERROR"]);
  });
});
