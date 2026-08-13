import { createHmac } from "node:crypto";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const keycloakBrowserUrl = "http://keycloak.localhost:18184";
const seededAccountName = "Claude Enterprise · Central";
const adminStorageCheckpoint = resolve(
  process.cwd(),
  "test-results/.vendor-accounts-admin-storage.json",
);
let vendorAccountsAdminTotpSecret = "";

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
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

async function signIn(
  page: Page,
  username: string,
  password: string,
  expectedPath: string,
): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("btn_continue_corporativo").click();
  await expect(page).toHaveURL(new RegExp(`^${keycloakBrowserUrl}`));
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();
  await expect(page).toHaveURL(expectedPath);
}

async function signInGroupAdmin(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("btn_continue_corporativo").click();
  await expect(page).toHaveURL(new RegExp(`^${keycloakBrowserUrl}`));
  await page.locator("#username").fill("vendor-accounts-admin");
  await page
    .locator("#password")
    .fill("vendor-accounts-admin-test-password");
  await page.locator("#kc-login").click();
  const enrollmentSecret = page.locator("#kc-totp-secret-key");
  if (page.url().includes("CONFIGURE_TOTP")) {
    if (!(await enrollmentSecret.isVisible())) {
      await page.getByRole("link", { name: "Unable to scan?" }).click();
    }
    await expect(enrollmentSecret).toBeVisible();
    const secret =
      (await enrollmentSecret.textContent())?.replaceAll(" ", "") ?? "";
    vendorAccountsAdminTotpSecret = secret;
    expect(vendorAccountsAdminTotpSecret).not.toBe("");
    await page.locator("#totp").fill(totp(vendorAccountsAdminTotpSecret));
    const label = page.locator("#userLabel");
    if (await label.isVisible()) await label.fill("vendor-accounts-e2e");
    await page.locator("#saveTOTPBtn").click();
  } else if (await page.locator("#otp").isVisible()) {
    expect(vendorAccountsAdminTotpSecret).not.toBe("");
    await page.locator("#otp").fill(totp(vendorAccountsAdminTotpSecret));
    await page.locator("#kc-login").click();
  }
  await expect(page).toHaveURL("/panel");
}

async function authenticatedPage(
  browser: Browser,
  login: (page: Page) => Promise<void>,
): Promise<{ readonly context: BrowserContext; readonly page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page);
  return { context, page };
}

async function groupAdminPage(
  browser: Browser,
  retry: number,
): Promise<{ readonly context: BrowserContext; readonly page: Page }> {
  if (retry > 0) {
    const context = await browser.newContext({ storageState: adminStorageCheckpoint });
    return { context, page: await context.newPage() };
  }
  const authenticated = await authenticatedPage(browser, signInGroupAdmin);
  await authenticated.context.storageState({ path: adminStorageCheckpoint });
  return authenticated;
}

test("vendor-account authorization and create journey uses the real application stack", async ({
  browser,
}, testInfo) => {
  const createdAccountName = `US-025 E2E Organization ${process.pid}-${testInfo.workerIndex}-${testInfo.retry}`;
  const anonymousContext = await browser.newContext();
  const anonymous = await anonymousContext.newPage();
  await anonymous.goto("/organizaciones");
  await expect(anonymous).toHaveURL(/\/login\?callbackUrl=%2Forganizaciones$/);
  await expect(anonymous.getByText(seededAccountName)).toHaveCount(0);

  const employee = await authenticatedPage(browser, (page) =>
    signIn(page, "employee", "employee-test-password", "/solicitudes"),
  );
  await employee.page.goto("/organizaciones");
  await expect(employee.page).toHaveURL("/acceso-denegado");
  await expect(employee.page.getByText(seededAccountName)).toHaveCount(0);
  await employee.page.goto("/organizaciones/20000000-0000-0000-0000-000000000461");
  await expect(employee.page).toHaveURL("/acceso-denegado");
  await expect(employee.page.getByText(seededAccountName)).toHaveCount(0);

  const admin = await groupAdminPage(browser, testInfo.retry);
  try {
    if (process.env.US025_VERIFY_RETRY === "1" && testInfo.retry === 0) {
      throw new Error("US-025 deterministic retry-path verification");
    }
    await admin.page.goto("/organizaciones");
    const main = admin.page.locator("#main-content");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(
      /Organizaciones|Vendor organizations/,
    );
    const seededRow = main.getByRole("row", { name: new RegExp(seededAccountName) });
    await expect(seededRow).toContainText(/8 compradas \/ 6 libres|8 purchased \/ 6 free/);
    await expect(seededRow).toContainText(/30 abr 2027|Apr 30, 2027/);
    await expect(seededRow).toContainText(/Correcta|Healthy/);
    await expect(seededRow.getByRole("cell").nth(7)).toHaveText("3");

    await seededRow.getByRole("link", { name: seededAccountName }).click();
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(seededAccountName);
    await expect(main.getByTestId("tile_purchased")).toContainText("8");
    await expect(main.getByTestId("tile_assigned")).toContainText("1");
    await expect(main.getByTestId("tile_pending")).toContainText("1");
    await expect(main.getByTestId("tile_free")).toContainText("6");
    const detailHeader = main.getByRole("heading", { level: 1 }).locator("..");
    await expect(detailHeader).toContainText("Anthropic");
    await expect(detailHeader).toContainText(/Automatizada|Automated/);
    await expect(detailHeader).toContainText(/30 abr 2027|Apr 30, 2027/);
    const capabilities = main.getByRole("region", { name: /Capacidades del conector|Connector capabilities/ });
    for (const label of [
      /Aprovisionar miembros|Provision members/,
      /Desaprovisionar miembros|Deprovision members/,
      /Datos de uso|Usage data/,
      /Datos de costo|Cost data/,
    ]) {
      await expect(capabilities.getByText(label).locator("..")).toContainText(/Compatible|Supported/);
    }
    await expect(capabilities).toContainText("REST");
    await expect(capabilities).toContainText(/Correo|Email/);
    await expect(capabilities).toContainText(/Las operaciones no compatibles se derivan|Unsupported operations are routed/);
    await main.getByRole("tab", { name: /Tipos de licencia|License types/ }).click();
    const licenses = main.getByRole("table", { name: /Tipos de licencia configurados|Configured license types/ });
    await expect(licenses.getByRole("row", { name: /Claude Enterprise/ })).toContainText(/\$49[,.]00/);
    await expect(licenses.getByRole("row", { name: /Claude Legacy/ })).toContainText(/Inactiva|Inactive/);
    await expect(licenses).not.toContainText(/\$99[,.]00/);
    await expect(licenses.getByRole("button")).toHaveCount(0);
    await expect(licenses.getByRole("link")).toHaveCount(0);

    await admin.page.goto("/organizaciones/not-a-uuid");
    await expect(admin.page.getByRole("heading", { name: /404/ })).toBeVisible();
    await admin.page.goto("/organizaciones/20000000-0000-4000-8000-999999999999");
    await expect(admin.page.getByRole("heading", { name: /404/ })).toBeVisible();
    await admin.page.goto("/organizaciones");

    await main.getByTestId("btn_new_vendor_account").click();
    const dialog = admin.page.getByTestId("modal_new_vendor_account");
    await expect(dialog.locator('select[name="vendorId"] option')).toHaveCount(1);
    await expect(dialog.locator('select[name="vendorId"]')).toHaveValue("20000000-0000-0000-0000-000000000460");
    await expect(dialog.locator('select[name="vendorId"]')).toContainText("Anthropic");
    await dialog.locator('input[name="name"]').fill(createdAccountName);
    await dialog.getByTestId("btn_create_vendor_account").click();
    await expect(dialog).toBeHidden();
    await expect(
      main.getByText(
        /Organización creada\. Ahora carga su capacidad y credenciales\.|Organization created\. Now add its capacity and credentials\./,
      ),
    ).toBeVisible();
    await admin.page.reload();
    const createdRow = main.getByRole("row", { name: new RegExp(createdAccountName) });
    await expect(createdRow).toContainText(/0 compradas \/ 0 libres|0 purchased \/ 0 free/);
    const createdLink = createdRow.getByRole("link", { name: createdAccountName });
    const createdHref = await createdLink.getAttribute("href");
    expect(createdHref).toMatch(/^\/organizaciones\/[0-9a-f-]{36}$/);
    if (!createdHref) throw new Error("Created vendor account link has no href");

    await main.getByTestId("btn_new_vendor_account").click();
    await dialog.locator('input[name="name"]').fill(createdAccountName);
    await dialog.getByTestId("btn_create_vendor_account").click();
    await expect(
      dialog.getByText(
        /Ya existe una organización con este nombre o referencia del proveedor\.|An organization with this name or vendor reference already exists\./,
      ),
    ).toBeVisible();
    await expect(main.getByRole("link", { name: createdAccountName })).toHaveCount(1);

    await dialog.getByRole("button", { name: /Cancelar|Cancel/ }).click();
    await createdLink.click();
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(createdAccountName);
    await expect(main.getByRole("heading", { name: /No hay capacidad registrada|No pool capacity recorded/ })).toBeVisible();
    await main.getByRole("tab", { name: /Configuración|Settings/ }).click();
    await expect(main.locator('input[aria-label="Proveedor"], input[aria-label="Vendor"]')).toHaveAttribute("readonly", "");
    await main.locator('select[name="mode"]').selectOption("orchestration");
    await main.locator('input[name="lowPoolFloor"]').fill("7");
    await main.locator('input[name="contractRenewalOn"]').fill("2028-09-30");
    await main.getByTestId("btn_save_vendor_account").click();
    await expect(main.getByText(/Configuración de la organización guardada\.|Organization settings saved\./)).toBeVisible();
    await admin.page.reload();
    await main.getByRole("tab", { name: /Configuración|Settings/ }).click();
    await expect(main.locator('select[name="mode"]')).toHaveValue("orchestration");
    await expect(main.locator('input[name="lowPoolFloor"]')).toHaveValue("7");
    await expect(main.locator('input[name="contractRenewalOn"]')).toHaveValue("2028-09-30");

    await main.locator('select[name="status"]').selectOption("inactive");
    await main.getByTestId("btn_save_vendor_account").click();
    await expect(main.getByText(/Configuración de la organización guardada\.|Organization settings saved\./)).toBeVisible();
    await admin.page.reload();
    await main.getByRole("tab", { name: /Configuración|Settings/ }).click();
    await expect(main.locator('select[name="status"]')).toHaveValue("inactive");
    await expect(main.locator('select[name="mode"]')).toHaveValue("orchestration");
    await expect(main.locator('input[name="lowPoolFloor"]')).toHaveValue("7");
    await expect(main.locator('input[name="contractRenewalOn"]')).toHaveValue("2028-09-30");

    await admin.page.goto("/organizaciones");
    const retiredRow = main.getByRole("row", { name: new RegExp(createdAccountName) });
    await expect(retiredRow).toContainText(/Orquestación|Orchestration/);
    await expect(retiredRow).toContainText(/30 sept 2028|Sep 30, 2028/);
    await expect(retiredRow.getByRole("cell").nth(7)).toHaveText("7");
    await expect(retiredRow).toContainText(/Inactiva|Inactive/);

    for (const action of [
      "vendor_account.created",
      "vendor_account.updated",
      "vendor_account.retired",
    ]) {
      await admin.page.goto(`/auditoria?entityType=VendorAccount&action=${action}`);
      const auditRow = main.locator(`tr:has(a[href="${createdHref}"])`);
      await expect(auditRow).toContainText(action);
      await expect(auditRow.getByRole("link")).toHaveAttribute("href", createdHref);
    }
    await unlink(adminStorageCheckpoint).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  } finally {
    await Promise.all([
      anonymousContext.close(),
      employee.context.close(),
      admin.context.close(),
    ]);
  }
});
