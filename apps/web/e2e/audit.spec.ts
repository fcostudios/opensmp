import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const keycloakBrowserUrl = "http://keycloak.localhost:18184";

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.replaceAll(" ", "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret: string): string {
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
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
  await page.getByTestId("btn_continue_corporativo").click();
  await expect(page).toHaveURL(new RegExp(`^${keycloakBrowserUrl}`));
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();
}

test.describe.configure({ mode: "serial" });

test("a non-group-admin cannot retrieve the audit screen", async ({
  page,
}) => {
  await beginLogin(page, "employee", "employee-test-password");
  await expect(page).toHaveURL("/solicitudes");

  await page.goto("/auditoria");

  await expect(page).toHaveURL("/acceso-denegado");
  await expect(page.getByTestId("table_audit")).toHaveCount(0);
});

test("group admin filters evidence and inspects the keyboard-contained diff", async ({
  page,
}) => {
  await beginLogin(
    page,
    "audit-admin",
    "audit-admin-test-password",
  );
  const secretElement = page.locator("#kc-totp-secret-key");
  if (!(await secretElement.isVisible())) {
    await page.getByRole("link", { name: "Unable to scan?" }).click();
  }
  const secret =
    (await secretElement.textContent())?.replaceAll(" ", "") ?? "";
  expect(secret).not.toBe("");
  await page.locator("#totp").fill(totp(secret));
  const label = page.locator("#userLabel");
  if (await label.isVisible()) await label.fill("audit-e2e");
  await page.locator("#saveTOTPBtn").click();
  await expect(page).toHaveURL("/panel");

  await page.goto("/auditoria");
  const main = page.locator("#main-content");
  await main
    .locator('select[name="entityType"]')
    .selectOption("Company");
  await main
    .getByRole("button", {
      name: /Aplicar filtros|Apply filters/,
    })
    .click();
  const table = main.getByTestId("table_audit");
  await expect(table).toContainText("company.updated");
  await table.getByText("company.updated").click();

  const dialog = page.getByTestId("modal_audit_diff");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("E2E audit note");
  await expect(dialog).toContainText("+ added");
  const close = dialog.getByTestId("btn_close_audit_diff");
  await close.focus();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
