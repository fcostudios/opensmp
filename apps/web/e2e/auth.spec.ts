import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

import { createKeycloakAdminClient } from "../src/lib/auth/keycloak-admin";

const keycloakAdminUrl = "http://127.0.0.1:18184";
const keycloakBrowserUrl = "http://keycloak.localhost:18184";
const adminClient = createKeycloakAdminClient({
  baseUrl: keycloakAdminUrl,
  realm: "corporativo",
  clientId: "smp-keycloak-admin",
  clientSecret: "us004-test-admin-secret",
});
let groupAdminTotpSecret: string;

async function keycloakServiceToken(): Promise<string> {
  const tokenResponse = await fetch(
    `${keycloakAdminUrl}/realms/corporativo/protocol/openid-connect/token`,
    {
      method: "POST",
      body: new URLSearchParams({
        client_id: "smp-keycloak-admin",
        client_secret: "us004-test-admin-secret",
        grant_type: "client_credentials",
      }),
    },
  );
  expect(tokenResponse.ok).toBe(true);
  const tokenPayload = (await tokenResponse.json()) as {
    access_token?: unknown;
  };
  expect(typeof tokenPayload.access_token).toBe("string");
  return String(tokenPayload.access_token);
}

async function findKeycloakUserId(username: string): Promise<string> {
  const usersResponse = await fetch(
    `${keycloakAdminUrl}/admin/realms/corporativo/users?username=${encodeURIComponent(username)}&exact=true`,
    {
      headers: {
        Authorization: `Bearer ${await keycloakServiceToken()}`,
      },
    },
  );
  expect(usersResponse.ok).toBe(true);
  const users = (await usersResponse.json()) as Array<{ id?: unknown }>;
  expect(users).toHaveLength(1);
  expect(typeof users[0]?.id).toBe("string");
  return String(users[0]?.id);
}

async function keycloakUserSessions(userId: string): Promise<unknown[]> {
  const response = await fetch(
    `${keycloakAdminUrl}/admin/realms/corporativo/users/${encodeURIComponent(userId)}/sessions`,
    {
      headers: {
        Authorization: `Bearer ${await keycloakServiceToken()}`,
      },
    },
  );
  expect(response.ok).toBe(true);
  const sessions = await response.json();
  expect(Array.isArray(sessions)).toBe(true);
  return sessions as unknown[];
}

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.replaceAll(" ", "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Keycloak emitted an invalid TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret: string, offset = 0): string {
  const counter = Math.floor(Date.now() / 30_000) + offset;
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret))
    .update(counterBytes)
    .digest();
  const index = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[index]! & 0x7f) << 24) |
    ((digest[index + 1]! & 0xff) << 16) |
    ((digest[index + 2]! & 0xff) << 8) |
    (digest[index + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

async function beginLogin(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto("/login");
  await expect(page.getByTestId("screen_login")).toBeVisible();
  await page.getByTestId("btn_continue_corporativo").click();
  await expect(page).toHaveURL(new RegExp(`^${keycloakBrowserUrl}`));
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();
}

async function completeTotpEnrollment(
  page: Page,
  label: string,
): Promise<string> {
  const secretElement = page.locator("#kc-totp-secret-key");
  if (!(await secretElement.isVisible())) {
    await page.getByRole("link", { name: "Unable to scan?" }).click();
  }
  await expect(secretElement).toBeVisible();
  const secret = (await secretElement.textContent())?.replaceAll(" ", "") ?? "";
  expect(secret).not.toBe("");
  await page.locator("#totp").fill(totp(secret));
  const labelInput = page.locator("#userLabel");
  if (await labelInput.isVisible()) await labelInput.fill(label);
  await page.locator("#saveTOTPBtn").click();
  return secret;
}

async function expectTotpEnrollmentRequired(page: Page): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`^${keycloakBrowserUrl}`));
  await expect(
    page.getByRole("heading", { name: "Mobile Authenticator Setup" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Unable to scan?" }),
  ).toBeVisible();
}

async function expectNoLedgerSession(page: Page): Promise<void> {
  const sessionCookie = (
    await page.context().cookies("http://localhost:3104")
  ).find(({ name }) => name === "authjs.session-token");
  expect(sessionCookie).toBeUndefined();

  const ledgerProbe = await page.context().newPage();
  try {
    const response = await ledgerProbe.goto(
      "http://localhost:3104/api/auth/session",
    );
    expect(response?.ok()).toBe(true);
    expect(await response?.json()).toBeNull();
  } finally {
    await ledgerProbe.close();
  }
}

test.describe.configure({ mode: "serial" });

test("public login and access-denied screens never render credential inputs or authenticated chrome", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page.getByTestId("screen_login")).toBeVisible();
  await expect(page.locator("input[type=password], input[name=otp]")).toHaveCount(
    0,
  );
  await expect(page.getByTestId("btn_logout")).toHaveCount(0);

  await page.goto("/acceso-denegado");
  await expect(page.getByTestId("banner_access_denied")).toBeVisible();
  await expect(page.getByTestId("actions_access_denied")).toBeVisible();
  await expect(page.getByTestId("btn_go_login")).toBeVisible();
  await expect(page.getByTestId("btn_logout")).toHaveCount(0);
});

for (const identity of [
  {
    name: "employee",
    username: "employee",
    password: "employee-test-password",
    destination: "/solicitudes",
  },
  {
    name: "approver",
    username: "approver",
    password: "approver-test-password",
    destination: "/aprobaciones",
  },
  {
    name: "company finance",
    username: "company-finance",
    password: "finance-test-password",
    destination: "/estados-de-cuenta",
  },
]) {
  test(`${identity.name} lands on ${identity.destination}`, async ({ page }) => {
    await beginLogin(page, identity.username, identity.password);
    await expect(page).toHaveURL(identity.destination);
  });
}

test("central finance cannot obtain a session until OTP enrollment completes and then lands on close", async ({
  page,
}) => {
  await beginLogin(page, "central-finance", "central-test-password");
  await expectNoLedgerSession(page);
  await completeTotpEnrollment(page, "central-finance-e2e");
  await expect(page).toHaveURL("/cierre");
});

test("group admin cannot obtain a session until OTP enrollment completes and then lands on panel", async ({
  page,
}) => {
  await beginLogin(page, "group-admin", "group-admin-test-password");
  await expectNoLedgerSession(page);
  groupAdminTotpSecret = await completeTotpEnrollment(
    page,
    "group-admin-e2e",
  );
  await expect(page).toHaveURL("/panel");

  const dynamicRoutes = [
    {
      path: "/companias/20000000-0000-0000-0000-000000000451",
      label: "Authentication Test Company",
    },
    {
      path: "/solicitudes/20000000-0000-0000-0000-000000000463",
      label: "REQ-BREADCRUMB",
    },
    {
      path: "/organizaciones/20000000-0000-0000-0000-000000000461",
      label: "Claude Enterprise · Central",
    },
    {
      path: "/personas/20000000-0000-0000-0000-000000000201",
      label: "Elena Employee",
    },
    {
      path:
        "/estados-de-cuenta/20000000-0000-0000-0000-000000000464",
      label: "AUTH-TEST · 2026-07",
    },
  ] as const;
  for (const route of dynamicRoutes) {
    await page.goto(route.path);
    await expect(page).toHaveURL(route.path);
    const breadcrumbs = page.getByRole("navigation", {
      name: /Migas de pan|Breadcrumbs/,
    });
    await expect(breadcrumbs).toContainText(route.label);
    await expect(breadcrumbs).not.toContainText(
      /Detalle|details|20000000-0000-0000-0000-0000000004/i,
    );
    await expect(page.getByRole("main")).toBeVisible();
  }
});

test("a disabled identity cannot obtain a Ledger session", async ({ page }) => {
  await beginLogin(page, "disabled", "disabled-test-password");
  await expect(page.locator("#input-error, .pf-v5-c-alert")).toBeVisible();
  await expectNoLedgerSession(page);
});

test("an administrator without configured OTP remains at Keycloak and has no Ledger session", async ({
  page,
}) => {
  await beginLogin(page, "admin-without-totp", "no-totp-test-password");
  await expectTotpEnrollmentRequired(page);
  await expectNoLedgerSession(page);
});

test("newly synchronized platform-admin membership challenges the candidate on the next login", async ({
  page,
}) => {
  const candidateId = await findKeycloakUserId("admin-candidate");
  await beginLogin(page, "admin-candidate", "candidate-test-password");
  await expect(page).toHaveURL("/acceso-denegado");
  expect(await keycloakUserSessions(candidateId)).not.toHaveLength(0);

  try {
    await adminClient.addUserToPlatformAdmin(candidateId);
    expect(await keycloakUserSessions(candidateId)).toEqual([]);

    await page.context().clearCookies({ name: "authjs.session-token" });
    await page.goto("/login");
    await page.getByTestId("btn_continue_corporativo").click();
    await expect(page).toHaveURL(new RegExp(`^${keycloakBrowserUrl}`));
    await expect(page.locator("#username")).toBeVisible();
    await page.locator("#username").fill("admin-candidate");
    await page.locator("#password").fill("candidate-test-password");
    await page.locator("#kc-login").click();
    await expectTotpEnrollmentRequired(page);
    await expectNoLedgerSession(page);
  } finally {
    await adminClient.removeUserFromPlatformAdmin(candidateId);
  }
});

test("wrong OTP remains in Keycloak and is operator-queryable as retained failure evidence", async ({
  page,
}) => {
  expect(groupAdminTotpSecret).toBeTruthy();
  await beginLogin(page, "group-admin", "group-admin-test-password");
  const validCode = totp(groupAdminTotpSecret);
  const wrongCode =
    validCode.slice(0, -1) + String((Number(validCode.at(-1)) + 1) % 10);
  await page.locator("#otp").fill(wrongCode);
  await page.locator("#kc-login").click();
  await expect(page).toHaveURL(new RegExp(`^${keycloakBrowserUrl}`));
  await expectNoLedgerSession(page);

  const events = await adminClient.listSecurityEvents({
    types: ["LOGIN_ERROR"],
    max: 50,
  });
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "LOGIN_ERROR",
        userId: await findKeycloakUserId("group-admin"),
      }),
    ]),
  );
});

test("logout clears Auth.js and Keycloak SSO sessions", async ({ page }) => {
  await beginLogin(page, "employee", "employee-test-password");
  await expect(page).toHaveURL("/solicitudes");
  await page.getByTestId("btn_logout").click();
  await expect(page).toHaveURL("/login");
  await expectNoLedgerSession(page);

  await page.getByTestId("btn_continue_corporativo").click();
  await expect(page).toHaveURL(new RegExp(`^${keycloakBrowserUrl}`));
  await expect(page.locator("#username")).toBeVisible();
});
