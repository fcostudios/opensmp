/**
 * CHG-121 — `pnpm demo:up --empty`: the demo users and provisional companies
 * exist (seeded by demo-s0-s1.setup.ts) but no journey runs. Each user signs in
 * once so the platform-admin TOTP is enrolled the same way the journey does it,
 * and every enrolled secret is written to the credentials file. Without this the
 * operator could still enroll from Keycloak's QR on the first manual login, but
 * the persisted-credentials login proof (demo-login.spec.ts) could not cover
 * this mode.
 */
import { expect, test } from "@playwright/test";

import { ROLE_LANDING, USERS, demoBaseUrl, demoConfigured, readCredentials, signIn } from "./demo-s0-s1.fixture";

test.skip(!demoConfigured, "Set DEMO_REHEARSAL_ENV_FILE to a disposable demo stack (CHG-121)");
test.describe.configure({ mode: "serial" });

for (const user of USERS) {
  test(`${user.username} signs in once; an admin's TOTP is enrolled and persisted`, async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, user.key, { allowEnrollment: true });
    // Signed in = redirected to the role's landing (whether it renders is
    // demo-login.spec.ts's concern; /panel has a known server-side failure).
    await expect(page).toHaveURL(`${demoBaseUrl}${ROLE_LANDING[user.key]}`);
    const stored = readCredentials()[user.key];
    if (user.platformAdmin) {
      expect(stored.totpSecret).toMatch(/^[A-Z2-7]{16,}$/);
      expect(stored.otpauthUri).toContain(`secret=${stored.totpSecret}`);
    } else {
      expect(stored.totpSecret).toBeUndefined();
    }
    await context.close();
  });
}
