import { readFile } from "node:fs/promises";

const baseUrl = process.env.KEYCLOAK_URL;
const adminUsername = process.env.KEYCLOAK_ADMIN_USERNAME;
const adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;
const fixturePath = process.env.KEYCLOAK_TEST_USERS_FILE;
if (!baseUrl || !adminUsername || !adminPassword || !fixturePath) {
  throw new Error("Keycloak test bootstrap environment is incomplete");
}

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (!response.ok) {
    throw new Error(
      `Keycloak test bootstrap ${init.method ?? "GET"} ${path} failed with ${response.status}`,
    );
  }
  return response;
}

const tokenResponse = await request(
  "/realms/master/protocol/openid-connect/token",
  {
    method: "POST",
    body: new URLSearchParams({
      client_id: "admin-cli",
      grant_type: "password",
      username: adminUsername,
      password: adminPassword,
    }),
  },
);
const { access_token: accessToken } = await tokenResponse.json();
if (typeof accessToken !== "string") {
  throw new Error("Keycloak test bootstrap did not receive an admin token");
}

async function adminRequest(path, init = {}) {
  return request(`/admin/realms/corporativo${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

const group = await (
  await adminRequest("/group-by-path/platform-admin")
).json();
if (typeof group.id !== "string") {
  throw new Error("Keycloak test bootstrap cannot resolve platform-admin");
}

const users = JSON.parse(await readFile(fixturePath, "utf8"));
for (const fixture of users) {
  const matches = await (
    await adminRequest(
      `/users?username=${encodeURIComponent(fixture.username)}&exact=true`,
    )
  ).json();
  let id = matches[0]?.id;
  if (!id) {
    const created = await adminRequest("/users", {
      method: "POST",
      body: JSON.stringify({
        id: fixture.id,
        username: fixture.username,
        email: fixture.email,
        firstName: fixture.firstName,
        lastName: fixture.lastName,
        emailVerified: true,
        enabled: fixture.enabled,
      }),
    });
    id = created.headers.get("location")?.split("/").at(-1);
  } else {
    await adminRequest(`/users/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({
        username: fixture.username,
        email: fixture.email,
        firstName: fixture.firstName,
        lastName: fixture.lastName,
        emailVerified: true,
        enabled: fixture.enabled,
      }),
    });
  }
  if (!id) throw new Error(`Keycloak test bootstrap failed for ${fixture.username}`);

  await adminRequest(`/users/${encodeURIComponent(id)}/reset-password`, {
    method: "PUT",
    body: JSON.stringify({
      type: "password",
      value: fixture.password,
      temporary: false,
    }),
  });
  const membershipPath =
    `/users/${encodeURIComponent(id)}/groups/${encodeURIComponent(group.id)}`;
  await adminRequest(membershipPath, {
    method: fixture.platformAdmin ? "PUT" : "DELETE",
  });
}
