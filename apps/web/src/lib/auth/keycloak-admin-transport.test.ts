import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";

import {
  createKeycloakAdminTransport,
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
