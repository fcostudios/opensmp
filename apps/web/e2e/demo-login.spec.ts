/**
 * CHG-121 — proof that the operator can sign in to a `pnpm demo:up` stack with
 * nothing but the persisted credentials file (DEMO_CREDENTIALS_FILE, the stable
 * copy outside the repository). It never enrolls: an admin without a stored
 * TOTP secret fails, and no globalSetup runs (seeding would regenerate the
 * passwords). Codes are computed from the stored secrets only.
 *
 * CHG-124: the file's `twoFactor` (verified in the realm during seeding) picks
 * the proof. "off": every user, admins included, lands on the app straight after
 * the password — signIn() throws on any OTP or TOTP setup page — and no TOTP
 * field is stored. "on": admins enter a code from the stored secret (CHG-121).
 * When `pnpm demo:up` passes DEMO_ADMIN_OTP, the file must agree with it.
 */
import { expect, test } from "@playwright/test";

import {
  ROLE_LANDING, USERS, currentTotpStep, demoBaseUrl, demoConfigured, readCredentials, signIn, twoFactorOf,
} from "./demo-s0-s1.fixture";

const credentialsFile = process.env.DEMO_CREDENTIALS_FILE ?? "";
test.skip(!demoConfigured || credentialsFile === "", "Set DEMO_REHEARSAL_ENV_FILE and DEMO_CREDENTIALS_FILE (CHG-121)");
test.describe.configure({ mode: "serial" });

const LANDING = ROLE_LANDING;
/**
 * A page each role works on in the demo, proving the session is usable. The
 * landing itself must also render: CHG-122 fixed /panel failing server-side on
 * production-shaped stacks (DATABASE_URL was not set there).
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
    const credentials = readCredentials(credentialsFile);
    const twoFactor = twoFactorOf(credentials);
    if (process.env.DEMO_ADMIN_OTP) expect(twoFactor, "credentials file matches the requested admin 2FA").toBe(process.env.DEMO_ADMIN_OTP);
    const stored = credentials[user.key];
    expect(stored.username).toBe(user.username);
    if (twoFactor === "off") {
      expect(stored.totpSecret, "no TOTP secret with admin 2FA off").toBeUndefined();
      expect(stored.otpauthUri).toBeUndefined();
    } else if (user.platformAdmin) {
      expect(stored.totpSecret, "admin TOTP secret is persisted").toBeTruthy();
    }
    const context = await browser.newContext();
    const page = await context.newPage();
    const met = await signIn(page, user.key, { allowEnrollment: false, file: credentialsFile, totpNotBefore: notBefore });
    expect(met, twoFactor === "off" ? "no OTP prompt with admin 2FA off" : "admins enter a TOTP code")
      .toBe(twoFactor === "on" && user.platformAdmin ? "code" : "none");
    await expect(page).toHaveURL(`${demoBaseUrl}${LANDING[user.key]}`);
    await page.waitForLoadState("load");
    await expect(page.locator("#main-content"), `${LANDING[user.key]} renders for ${user.username}`).toBeVisible();
    await expect(page.getByText(/couldn.t load/i)).toHaveCount(0);
    const working = WORKING_PAGE[user.key];
    await page.goto(working.path);
    await expect(page).toHaveURL(`${demoBaseUrl}${working.path}`);
    const main = page.locator("#main-content");
    await expect(main).toBeVisible();
    if (working.testId) await expect(main.getByTestId(working.testId)).toBeVisible();
    await context.close();
  });
}
