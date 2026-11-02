/**
 * CHG-121 — `pnpm demo:up --empty`: the demo users and provisional companies
 * exist (seeded by demo-s0-s1.setup.ts) but no journey runs. Each user signs in
 * once so the platform-admin TOTP is enrolled the same way the journey does it,
 * and every enrolled secret is written to the credentials file. Without this the
 * operator could still enroll from Keycloak's QR on the first manual login, but
 * the persisted-credentials login proof (demo-login.spec.ts) could not cover
 * this mode.
 *
 * CHG-124: with admin 2FA off (the `pnpm demo:up` default) nobody is asked for
 * OTP and the file must carry no TOTP fields at all.
 */
import { expect, test } from "@playwright/test";

import { ROLE_LANDING, USERS, demoBaseUrl, demoConfigured, readCredentials, signIn, twoFactorOf } from "./demo-s0-s1.fixture";

test.skip(!demoConfigured, "Set DEMO_REHEARSAL_ENV_FILE to a disposable demo stack (CHG-121)");
test.describe.configure({ mode: "serial" });

for (const user of USERS) {
  test(`${user.username} signs in once; with admin 2FA on, an admin's TOTP is enrolled and persisted`, async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const met = await signIn(page, user.key, { allowEnrollment: true });
    // Signed in = redirected to the role's landing (whether it renders is
    // demo-login.spec.ts's concern).
    await expect(page).toHaveURL(`${demoBaseUrl}${ROLE_LANDING[user.key]}`);
    const credentials = readCredentials();
    const stored = credentials[user.key];
    if (twoFactorOf(credentials) === "off") {
      expect(met, "no second factor with admin 2FA off").toBe("none");
      expect(stored.totpSecret).toBeUndefined();
      expect(stored.otpauthUri).toBeUndefined();
    } else if (user.platformAdmin) {
      expect(met).toBe("enrolled");
      expect(stored.totpSecret).toMatch(/^[A-Z2-7]{16,}$/);
      expect(stored.otpauthUri).toContain(`secret=${stored.totpSecret}`);
    } else {
      expect(stored.totpSecret).toBeUndefined();
    }
    await context.close();
  });
}
