import { createHmac } from "node:crypto";

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const keycloakBrowserUrl = "http://keycloak.localhost:18184";
const vendorAccountId = "20000000-0000-0000-0000-000000000471";
const licenseTypeId = "20000000-0000-0000-0000-000000000472";
const crossCompanyRequestId = "20000000-0000-0000-0000-000000000482";
const rejectionRequestId = "20000000-0000-0000-0000-000000000484";
const mismatchRequestId = "20000000-0000-0000-0000-000000000486";
const mismatchActionId = "20000000-0000-0000-0000-000000000488";
let groupAdminTotpSecret = "";
let groupAdminStorageState:
  | Awaited<ReturnType<BrowserContext["storageState"]>>
  | undefined;
let createdRequestId = "";
let createdRequestNo = "";

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
  await page.locator("#username").fill("group-admin");
  await page.locator("#password").fill("group-admin-test-password");
  await page.locator("#kc-login").click();

  const enrollmentSecret = page.locator("#kc-totp-secret-key");
  if (page.url().includes("CONFIGURE_TOTP")) {
    if (!(await enrollmentSecret.isVisible())) {
      await page.getByRole("link", { name: "Unable to scan?" }).click();
    }
    await expect(enrollmentSecret).toBeVisible();
    groupAdminTotpSecret =
      (await enrollmentSecret.textContent())?.replaceAll(" ", "") ?? "";
    expect(groupAdminTotpSecret).not.toBe("");
    await page.locator("#totp").fill(totp(groupAdminTotpSecret));
    const label = page.locator("#userLabel");
    if (await label.isVisible()) await label.fill("sprint2-e2e");
    await page.locator("#saveTOTPBtn").click();
  } else if (await page.locator("#otp").isVisible()) {
    expect(groupAdminTotpSecret).not.toBe("");
    await page.locator("#otp").fill(totp(groupAdminTotpSecret));
    await page.locator("#kc-login").click();
  }
  await expect(page).toHaveURL("/panel");
}

async function newAuthenticatedPage(
  browser: Browser,
  login: (page: Page) => Promise<void>,
): Promise<{ readonly context: BrowserContext; readonly page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page);
  return { context, page };
}

function appMain(page: Page) {
  return page.locator("#main-content");
}

async function poolFree(page: Page): Promise<number> {
  await page.goto("/cupos");
  const card = appMain(page).getByTestId(
    `pool_card_${vendorAccountId}_${licenseTypeId}`,
  );
  await expect(card).toBeVisible();
  const available = card.locator("dl div").filter({
    hasText: /Disponibles|Available/,
  });
  return Number(await available.locator("dd").textContent());
}

async function submitSelfRequest(page: Page, justification: string) {
  await page.goto("/solicitudes/nueva");
  const main = appMain(page);
  await main.getByTestId("field_vendor_account").selectOption(vendorAccountId);
  await main.getByTestId("field_license_type").selectOption(licenseTypeId);
  await main.getByTestId("field_justification").fill(justification);
  await main.getByTestId("btn_submit_request").click();
  return main;
}

test.describe.configure({ mode: "serial" });

test("request approval checklist register pool and audit remain one public journey", async ({
  browser,
}) => {
  const admin = await newAuthenticatedPage(browser, signInGroupAdmin);
  const employee = await newAuthenticatedPage(browser, (page) =>
    signIn(page, "employee", "employee-test-password", "/solicitudes"),
  );
  const approver = await newAuthenticatedPage(browser, (page) =>
    signIn(page, "approver", "approver-test-password", "/aprobaciones"),
  );
  try {
    groupAdminStorageState = await admin.context.storageState();
    const freeBefore = await poolFree(admin.page);

    await submitSelfRequest(
      employee.page,
      "Sprint 2 black-box orchestration journey",
    );
    await expect(employee.page).toHaveURL(
      /\/solicitudes\/[0-9a-f-]{36}\?created=1$/,
    );
    createdRequestId = new URL(employee.page.url()).pathname.split("/").at(-1)!;
    const employeeMain = appMain(employee.page);
    await expect(employeeMain.getByTestId("request_tiles")).toBeVisible();
    createdRequestNo =
      (
        await appMain(employee.page)
          .locator("header")
          .getByText(/SOL-\d{4}/)
          .textContent()
      )?.match(/SOL-\d{4}/)?.[0] ?? "";
    expect(createdRequestNo).toMatch(/^SOL-\d{4}$/);

    await employee.page.goto("/aprobaciones");
    await expect(employee.page).toHaveURL("/acceso-denegado");
    await expect(employee.page.locator("[data-testid^='btn_approve_']")).toHaveCount(0);
    await employee.page.goto(`/solicitudes/${createdRequestId}`);
    await expect(appMain(employee.page).getByTestId("approver_actions")).toHaveCount(0);

    await approver.page.goto(`/aprobaciones?requestId=${createdRequestId}`);
    const target = appMain(approver.page).getByTestId(
      `approval_target_${createdRequestId}`,
    );
    await expect(target).toBeVisible();
    await target.getByTestId(`btn_approve_${createdRequestId}`).click();
    const approvalDialog = approver.page.getByTestId("modal_approve");
    await expect(approvalDialog).toBeVisible();
    await approvalDialog.getByTestId("btn_confirm_approve").click();
    await expect(target).toBeHidden();

    await approver.page.goto(`/aprobaciones?requestId=${crossCompanyRequestId}`);
    await expect(
      appMain(approver.page).getByTestId(
        `approval_target_${crossCompanyRequestId}`,
      ),
    ).toHaveCount(0);

    await approver.page.goto(`/aprobaciones?requestId=${rejectionRequestId}`);
    const rejectionTarget = appMain(approver.page).getByTestId(
      `approval_target_${rejectionRequestId}`,
    );
    await rejectionTarget
      .getByTestId(`btn_reject_${rejectionRequestId}`)
      .click();
    const rejectionDialog = approver.page.getByTestId("modal_reject");
    await expect(rejectionDialog.getByTestId("btn_confirm_reject")).toBeDisabled();
    await rejectionDialog.getByTestId("decision_comment").fill(" ");
    await expect(rejectionDialog.getByTestId("btn_confirm_reject")).toBeDisabled();
    await rejectionDialog.getByTestId("btn_cancel_reject").click();

    await admin.page.goto(`/solicitudes/${createdRequestId}`);
    const checklist = appMain(admin.page).getByTestId("checklist_pending");
    await expect(checklist).toBeVisible();
    await checklist.getByTestId("btn_confirm_checklist").click();
    const checklistDialog = admin.page.getByRole("dialog", {
      name: /Confirmar|Confirm/,
    });
    await checklistDialog.locator("[data-dialog-confirm]").click();
    await expect(checklist).toBeHidden();
    await expect(appMain(admin.page).getByTestId("tile_estado")).toContainText(
      /Activa|Active/,
    );
    await expect(appMain(admin.page).getByTestId("tab_asignacion")).toBeVisible();

    await admin.page.goto("/registro");
    const register = appMain(admin.page).getByTestId("register_table").first();
    await expect(register).toContainText("Elena Employee");
    await expect(register).toContainText(createdRequestNo);

    expect(await poolFree(admin.page)).toBe(freeBefore - 1);

    await admin.page.goto(`/solicitudes/${createdRequestId}?tab=audit`);
    const audit = appMain(admin.page).getByTestId("auditoria_table");
    // Task 17's illustrative request.created/checklist.confirmed/
    // assignment.created labels map to the accepted canonical lifecycle events;
    // the register assertion above is the assignment-creation oracle.
    for (const action of [
      "request.submitted",
      "request.approved",
      "orchestration.checklist_confirmed",
      "request.active",
    ]) {
      await expect(audit).toContainText(action);
    }
  } finally {
    await Promise.all([
      admin.context.close(),
      employee.context.close(),
      approver.context.close(),
    ]);
  }
});

test("duplicate submission links to the retained active assignment", async ({
  page,
}) => {
  expect(createdRequestId).not.toBe("");
  await signIn(page, "employee", "employee-test-password", "/solicitudes");
  const main = await submitSelfRequest(
    page,
    "Duplicate must resolve to the existing assignment",
  );

  const assignmentLink = main.getByTestId("btn_ver_asignacion");
  await expect(assignmentLink).toBeVisible();
  await assignmentLink.click();
  await expect(page).toHaveURL(`/solicitudes/${createdRequestId}`);
  await appMain(page).getByTestId("tab_asignacion").click();
  await expect(appMain(page).getByTestId("asignacion_panel")).toContainText(
    /Activa|Active/,
  );
});

test("a later mismatch stays visible without erasing its assignment", async ({
  browser,
}) => {
  // Serial dependency: reuse only the first test's completed Keycloak UI session.
  if (!groupAdminStorageState) {
    throw new Error("Primary journey did not retain the authenticated admin session");
  }
  const context = await browser.newContext({
    storageState: groupAdminStorageState,
  });
  const page = await context.newPage();
  try {
    await page.goto("/excepciones?tab=failed");
    await expect(
      appMain(page).getByTestId(`estado-${mismatchActionId}`),
    ).toContainText(/Verificación fallida|Verification failed/);
    await expect(
      appMain(page).getByTestId(`motivo-${mismatchActionId}`),
    ).toContainText(/no encontró|did not find/i);

    await page.goto(`/solicitudes/${mismatchRequestId}`);
    await expect(appMain(page).getByTestId("acciones_table")).toContainText(
      /Verificación fallida|Verification failed/,
    );
    await appMain(page).getByTestId("tab_asignacion").click();
    await expect(appMain(page).getByTestId("asignacion_panel")).toContainText(
      /Activa|Active/,
    );
  } finally {
    await context.close();
  }
});
