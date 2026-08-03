import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";

import {
  createKeycloakAdminTransport,
  KeycloakAdminError,
  readKeycloakJson,
} from "./keycloak-admin-transport";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
});

async function listen(
  handler: RequestListener,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe("Keycloak admin client-credentials transport", () => {
  test("coalesces concurrent service-token acquisition", async () => {
    let tokenRequests = 0;
    const baseUrl = await listen((request, response) => {
      if (request.url?.endsWith("/protocol/openid-connect/token")) {
        tokenRequests += 1;
        setTimeout(() => {
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ access_token: "shared", expires_in: 60 }));
        }, 20);
        return;
      }
      response.statusCode = 204;
      response.end();
    });
    const transport = createKeycloakAdminTransport({ baseUrl, realm: "realm", clientId: "client", clientSecret: "secret" });

    await Promise.all(Array.from({ length: 12 }, (_, index) => transport.request(`request-${index}`, `/users/${index}`)));

    expect(tokenRequests).toBe(1);
  });
  test("reports sanitized operation and status details", () => {
    const providerError = new KeycloakAdminError("create-user", 503);
    expect(providerError).toBeInstanceOf(Error);
    expect(providerError.name).toBe("KeycloakAdminError");
    expect(providerError.message).toBe("Keycloak admin operation create-user failed with status 503");
    expect(providerError).toMatchObject({ operation: "create-user", status: 503 });

    const networkError = new KeycloakAdminError("create-user", null);
    expect(networkError.message).toBe("Keycloak admin operation create-user failed");
    expect(networkError.status).toBeNull();
  });

  test("rejects invalid JSON with the response status and operation", async () => {
    await expect(readKeycloakJson(new Response("not-json", { status: 202 }), "decode-user"))
      .rejects.toMatchObject({ operation: "decode-user", status: 202 });
    await expect(readKeycloakJson(new Response(JSON.stringify({ id: "user-1" }), { status: 200 }), "decode-user"))
      .resolves.toEqual({ id: "user-1" });
  });

  test.each([
    ["array", []],
    ["missing token", { expires_in: 60 }],
    ["non-string token", { access_token: 7, expires_in: 60 }],
    ["blank token", { access_token: "  ", expires_in: 60 }],
    ["missing expiry", { access_token: "token" }],
    ["non-number expiry", { access_token: "token", expires_in: "60" }],
    ["non-finite expiry", { access_token: "token", expires_in: Number.POSITIVE_INFINITY }],
    ["zero expiry", { access_token: "token", expires_in: 0 }],
    ["negative expiry", { access_token: "token", expires_in: -1 }],
  ])("rejects a malformed service token: %s", async (_case, payload) => {
    let adminRequests = 0;
    const baseUrl = await listen((request, response) => {
      if (request.url?.endsWith("/protocol/openid-connect/token")) {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(payload));
        return;
      }
      adminRequests += 1;
      response.statusCode = 204;
      response.end();
    });
    const transport = createKeycloakAdminTransport({ baseUrl, realm: "contract", clientId: "client", clientSecret: "secret" });

    await expect(transport.request("disable-user", "/users/user-1"))
      .rejects.toMatchObject({ operation: "obtain-service-token", status: 200 });
    expect(adminRequests).toBe(0);
  });

  test("normalizes URLs, encodes the realm, trims tokens, and composes request headers", async () => {
    const requests: Array<{ url: string | undefined; method: string | undefined; authorization: string | undefined; contentType: string | undefined; trace: string | undefined; body: string }> = [];
    const baseUrl = await listen((request, response) => {
      if (request.url?.endsWith("/protocol/openid-connect/token")) {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => { body += chunk; });
        request.on("end", () => {
          requests.push({ url: request.url, method: request.method, authorization: request.headers.authorization, contentType: request.headers["content-type"], trace: request.headers["x-trace"] as string | undefined, body });
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ access_token: "  exact-token  ", expires_in: 60 }));
        });
        return;
      }
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => { body += chunk; });
      request.on("end", () => {
        requests.push({ url: request.url, method: request.method, authorization: request.headers.authorization, contentType: request.headers["content-type"], trace: request.headers["x-trace"] as string | undefined, body });
        response.statusCode = 204;
        response.end();
      });
    });
    const transport = createKeycloakAdminTransport({ baseUrl: `${baseUrl}///`, realm: "realm / ñ", clientId: "client id", clientSecret: "secret&value", now: () => 0 });
    await transport.request("update-user", "/users/user%201", { method: "PUT", body: JSON.stringify({ enabled: false }), headers: { "X-Trace": "trace-1" } });

    expect(requests).toEqual([
      { url: "/realms/realm%20%2F%20%C3%B1/protocol/openid-connect/token", method: "POST", authorization: undefined, contentType: "application/x-www-form-urlencoded;charset=UTF-8", trace: undefined, body: "client_id=client+id&client_secret=secret%26value&grant_type=client_credentials" },
      { url: "/admin/realms/realm%20%2F%20%C3%B1/users/user%201", method: "PUT", authorization: "Bearer exact-token", contentType: "application/json", trace: "trace-1", body: "{\"enabled\":false}" },
    ]);
  });

  test("refreshes at the five-second safety boundary but caches before it", async () => {
    let now = 0;
    let tokenRequests = 0;
    const authorizations: Array<string | undefined> = [];
    const baseUrl = await listen((request, response) => {
      if (request.url?.endsWith("/protocol/openid-connect/token")) {
        tokenRequests += 1;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ access_token: `token-${tokenRequests}`, expires_in: 10 }));
        return;
      }
      authorizations.push(request.headers.authorization);
      response.statusCode = 204;
      response.end();
    });
    const transport = createKeycloakAdminTransport({ baseUrl, realm: "contract", clientId: "client", clientSecret: "secret", now: () => now });

    await transport.request("read", "/users/one");
    now = 4_999;
    await transport.request("read", "/users/two");
    now = 5_000;
    await transport.request("read", "/users/three");

    expect(tokenRequests).toBe(2);
    expect(authorizations).toEqual(["Bearer token-1", "Bearer token-1", "Bearer token-2"]);
  });

  test("maps token, admin, and network failures without leaking response bodies", async () => {
    const tokenFailureUrl = await listen((_request, response) => {
      response.statusCode = 403;
      response.end("secret response");
    });
    await expect(createKeycloakAdminTransport({ baseUrl: tokenFailureUrl, realm: "contract", clientId: "client", clientSecret: "secret" }).request("read", "/users/one"))
      .rejects.toMatchObject({ operation: "obtain-service-token", status: 403 });

    const adminFailureUrl = await listen((request, response) => {
      if (request.url?.endsWith("/token")) {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ access_token: "token", expires_in: 60 }));
      } else {
        response.statusCode = 409;
        response.end("provider secret");
      }
    });
    await expect(createKeycloakAdminTransport({ baseUrl: adminFailureUrl, realm: "contract", clientId: "client", clientSecret: "secret" }).request("create-user", "/users"))
      .rejects.toMatchObject({ operation: "create-user", status: 409 });

    const closedUrl = await listen((_request, response) => response.end());
    await new Promise<void>((resolve, reject) => servers.pop()!.close((error) => error ? reject(error) : resolve()));
    await expect(createKeycloakAdminTransport({ baseUrl: closedUrl, realm: "contract", clientId: "client", clientSecret: "secret" }).request("read", "/users/one"))
      .rejects.toMatchObject({ operation: "obtain-service-token", status: null });
  });
  test("refreshes once after a 401 and reuses the refreshed unexpired token", async () => {
    let tokenRequests = 0;
    const authorizationHeaders: Array<string | undefined> = [];
    const baseUrl = await listen((request, response) => {
      if (request.url?.endsWith("/protocol/openid-connect/token")) {
        tokenRequests += 1;
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            access_token: `token-${tokenRequests}`,
            expires_in: 60,
          }),
        );
        return;
      }
      authorizationHeaders.push(request.headers.authorization);
      response.statusCode =
        request.headers.authorization === "Bearer token-1" ? 401 : 204;
      response.end();
    });
    const transport = createKeycloakAdminTransport({
      baseUrl,
      realm: "contract",
      clientId: "client",
      clientSecret: "secret",
      now: () => 0,
    });

    await transport.request("disable-user", "/users/user-1", {
      method: "PUT",
    });
    await transport.request("disable-user", "/users/user-2", {
      method: "PUT",
    });

    expect(tokenRequests).toBe(2);
    expect(authorizationHeaders).toEqual([
      "Bearer token-1",
      "Bearer token-2",
      "Bearer token-2",
    ]);
  });

  test("stops after one unauthorized retry", async () => {
    let tokenRequests = 0;
    let adminRequests = 0;
    const baseUrl = await listen((request, response) => {
      if (request.url?.endsWith("/protocol/openid-connect/token")) {
        tokenRequests += 1;
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            access_token: `token-${tokenRequests}`,
            expires_in: 60,
          }),
        );
        return;
      }
      adminRequests += 1;
      response.statusCode = 401;
      response.end();
    });
    const transport = createKeycloakAdminTransport({
      baseUrl,
      realm: "contract",
      clientId: "client",
      clientSecret: "secret",
      now: () => 0,
    });

    await expect(
      transport.request("disable-user", "/users/user-1", { method: "PUT" }),
    ).rejects.toMatchObject({
      operation: "disable-user",
      status: 401,
    });
    expect(tokenRequests).toBe(2);
    expect(adminRequests).toBe(2);
  });
});
