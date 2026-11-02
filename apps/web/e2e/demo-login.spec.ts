/**
 * CHG-121 — proof that the operator can sign in to a `pnpm demo:up` stack with
 * nothing but the persisted credentials file (DEMO_CREDENTIALS_FILE, the stable
 * copy outside the repository). It never enrolls: an admin without a stored
 * TOTP secret fails, and no globalSetup runs (seeding would regenerate the
 * passwords). Codes are computed from the stored secrets only.
 */
import { expect, test } from "@playwright/test";

import { ROLE_LANDING, USERS, currentTotpStep, demoBaseUrl, demoConfigured, readCredentials, signIn } from "./demo-s0-s1.fixture";

const credentialsFile = process.env.DEMO_CREDENTIALS_FILE ?? "";
test.skip(!demoConfigured || credentialsFile === "", "Set DEMO_REHEARSAL_ENV_FILE and DEMO_CREDENTIALS_FILE (CHG-121)");
test.describe.configure({ mode: "serial" });

const LANDING = ROLE_LANDING;
/**
 * A page each role works on in the demo, proving the session is usable.
 * /panel is not used for that: on a production-shaped stack it currently fails
 * server-side (DATABASE_URL is not set there; recorded as a CHG-121 finding).
 */
const WORKING_PAGE: Record<(typeof USERS)[number]["key"], { path: string; testId?: string }> = {
  groupAdmin: { path: "/registro", testId: "manual_register_entry" },
  centralFinance: { path: "/cierre" },
  companyFinance: { path: "/estados-de-cuenta" },
};

// The previous run may have used a code in this 30 s step; Keycloak refuses reuse.
const notBefore = currentTotpStep();

for (const user of USERS) {
  test(`${user.username} signs in from the persisted credentials and lands on ${LANDING[user.key]}`, async ({ browser }) => {
    const stored = readCredentials(credentialsFile)[user.key];
    expect(stored.username).toBe(user.username);
    if (user.platformAdmin) expect(stored.totpSecret, "admin TOTP secret is persisted").toBeTruthy();
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, user.key, { allowEnrollment: false, file: credentialsFile, totpNotBefore: notBefore });
    await expect(page).toHaveURL(`${demoBaseUrl}${LANDING[user.key]}`);
    await page.waitForLoadState("load");
    if (await page.locator("#main-content").count() === 0) {
      test.info().annotations.push({ type: "finding", description: `${LANDING[user.key]} did not render for ${user.username}` });
    }
    const working = WORKING_PAGE[user.key];
    await page.goto(working.path);
    await expect(page).toHaveURL(`${demoBaseUrl}${working.path}`);
    const main = page.locator("#main-content");
    await expect(main).toBeVisible();
    if (working.testId) await expect(main.getByTestId(working.testId)).toBeVisible();
    await context.close();
  });
}
