import { createHmac } from "node:crypto";

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import pg from "pg";

const keycloakBrowserUrl = "http://keycloak.localhost:18184";
const ownerUrl = "postgresql://ledger_owner:change-me-owner@127.0.0.1:15434/ledger";
const detailFixtureId = "20000000-0000-0000-0000-000000000466";
const detailFixtureName = "US-025 Detail Fixture";
const seededAccountName = "Claude Enterprise · Central";

async function resetDetailFixture(): Promise<void> {
  const owner = new pg.Client({ connectionString: ownerUrl });
  try {
    await owner.connect();
    await owner.query(
      `UPDATE vendor_account
       SET name=$2, mode='automated', vendor_org_ref=NULL,
           contract_renewal_on=NULL, low_pool_floor=0, status='active',
           updated_at=NULL, updated_by=NULL
       WHERE id=$1`,
      [detailFixtureId, detailFixtureName],
    );
  } finally {
    await owner.end();
  }
}

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
  if (!(await enrollmentSecret.isVisible())) {
    await page.getByRole("link", { name: "Unable to scan?" }).click();
  }
  const secret =
    (await enrollmentSecret.textContent())?.replaceAll(" ", "") ?? "";
  expect(secret).not.toBe("");
  await page.locator("#totp").fill(totp(secret));
  const label = page.locator("#userLabel");
  if (await label.isVisible()) await label.fill("vendor-accounts-e2e");
  await page.locator("#saveTOTPBtn").click();
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

test("vendor-account authorization and create journey uses the real application stack", async ({
  browser,
}, testInfo) => {
  const createdAccountName = `US-025 E2E Organization ${process.pid}-${testInfo.workerIndex}-${testInfo.retry}`;
  await resetDetailFixture();
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

  const admin = await authenticatedPage(browser, signInGroupAdmin);
  try {
    await admin.page.goto("/organizaciones");
    const main = admin.page.locator("#main-content");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(
      /Organizaciones|Vendor organizations/,
    );
    await expect(main.getByRole("link", { name: seededAccountName })).toBeVisible();
    await expect(main.getByRole("link", { name: detailFixtureName })).toBeVisible();

    await main.getByRole("link", { name: detailFixtureName }).click();
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(detailFixtureName);
    const detailHeader = main.getByRole("heading", { level: 1 }).locator("..");
    await expect(detailHeader).toContainText("Anthropic");
    await expect(detailHeader).toContainText(/Automatizada|Automated/);
    await expect(detailHeader).toContainText(/Sin definir|Not set/);
    await expect(main.getByRole("region", { name: /Capacidades del conector|Connector capabilities/ })).toContainText(/Aprovisionar miembros|Provision members/);
    await expect(main.getByRole("region", { name: /Capacidades del conector|Connector capabilities/ })).toContainText(/Las operaciones no compatibles se derivan|Unsupported operations are routed/);
    await expect(main.getByRole("heading", { name: /No hay capacidad registrada|No pool capacity recorded/ })).toBeVisible();
    await main.getByRole("tab", { name: /Tipos de licencia|License types/ }).click();
    const licenses = main.getByRole("table", { name: /Tipos de licencia configurados|Configured license types/ });
    await expect(licenses.getByRole("row", { name: /Claude Enterprise/ })).toContainText(/\$49[,.]00/);
    await expect(licenses.getByRole("button")).toHaveCount(0);
    await expect(licenses.getByRole("link")).toHaveCount(0);
    await main.getByRole("tab", { name: /Configuración|Settings/ }).click();
    await expect(main.locator('input[aria-label="Proveedor"], input[aria-label="Vendor"]')).toHaveAttribute("readonly", "");
    await main.locator('input[name="vendorOrgRef"]').fill("org-e2e-persisted");
    await main.locator('input[name="contractRenewalOn"]').fill("2027-06-30");
    await main.getByTestId("btn_save_vendor_account").click();
    await expect(main.getByText(/Configuración de la organización guardada\.|Organization settings saved\./)).toBeVisible();
    await admin.page.reload();
    await main.getByRole("tab", { name: /Configuración|Settings/ }).click();
    await expect(main.locator('input[name="vendorOrgRef"]')).toHaveValue("org-e2e-persisted");
    await expect(main.locator('input[name="contractRenewalOn"]')).toHaveValue("2027-06-30");

    await admin.page.goto("/organizaciones/not-a-uuid");
    await expect(admin.page.getByRole("heading", { name: /404/ })).toBeVisible();
    await admin.page.goto("/organizaciones/20000000-0000-4000-8000-999999999999");
    await expect(admin.page.getByRole("heading", { name: /404/ })).toBeVisible();
    await admin.page.goto("/organizaciones");

    await main.getByTestId("btn_new_vendor_account").click();
    const dialog = admin.page.getByTestId("modal_new_vendor_account");
    await dialog.locator('input[name="name"]').fill(createdAccountName);
    await dialog.getByTestId("btn_create_vendor_account").click();
    await expect(dialog).toBeHidden();
    await expect(
      main.getByText(
        /Organización creada\. Ahora carga su capacidad y credenciales\.|Organization created\. Now add its capacity and credentials\./,
      ),
    ).toBeVisible();
    await expect(main.getByRole("link", { name: createdAccountName })).toBeVisible();

    await main.getByTestId("btn_new_vendor_account").click();
    await dialog.locator('input[name="name"]').fill(createdAccountName);
    await dialog.getByTestId("btn_create_vendor_account").click();
    await expect(
      dialog.getByText(
        /Ya existe una organización con este nombre o referencia del proveedor\.|An organization with this name or vendor reference already exists\./,
      ),
    ).toBeVisible();
    await expect(main.getByRole("link", { name: createdAccountName })).toHaveCount(1);
  } finally {
    await Promise.all([
      anonymousContext.close(),
      employee.context.close(),
      admin.context.close(),
    ]);
  }
});
