import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  USERS,
  assertDisposableTarget,
  bootstrapSql,
  credentialsFile,
  demoConfigured,
  demoProject,
  evidenceDir,
  generatePasswords,
  psql,
  readCredentials,
  rehearsalEnv,
  repositoryRoot,
  requestedTwoFactor,
} from "./demo-s0-s1.fixture";

/**
 * Seeds the CHG-118 provisional reference data and the three role identities
 * into the disposable rehearsal stack. Never touches any other Compose project.
 *
 * CHG-124: DEMO_ADMIN_OTP=off (the `pnpm demo:up` default) then disables the
 * platform-admin OTP step in this stack's running realm through its admin API;
 * unset or "on" leaves the realm's 2FA as imported and only verifies it.
 */
export default async function setupDemoRehearsal(): Promise<void> {
  if (!demoConfigured) return; // The spec skips itself without a demo stack.
  assertDisposableTarget();
  const twoFactor = requestedTwoFactor();
  mkdirSync(evidenceDir, { recursive: true });

  const seeded = psql(bootstrapSql()).trim().split("\n").at(-1);
  if (seeded !== "5") throw new Error(`Expected five provisional companies, found ${seeded}`);

  const passwords = generatePasswords();
  const users = USERS.map((user) => ({
    id: undefined,
    username: user.username,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    password: passwords[user.key],
    enabled: true,
    platformAdmin: user.platformAdmin,
  }));
  // The realm as imported enforces admin OTP; "off" is recorded only once verified below.
  writeFileSync(credentialsFile, JSON.stringify({
    twoFactor: "on",
    ...Object.fromEntries(USERS.map((user) => [user.key, { username: user.username, password: passwords[user.key] }])),
  }, null, 2), { mode: 0o600 });
  const usersFile = resolve(evidenceDir, "keycloak-users.json");
  writeFileSync(usersFile, JSON.stringify(users), { mode: 0o644 });

  // The Keycloak admin API is deliberately not proxied by Caddy; reach it on
  // the rehearsal's private Compose network with the rehearsal's own admin.
  const env = rehearsalEnv();
  const keycloakAdmin = (script: string, extra: string[]) => execFileSync("docker", [
    "run", "--rm", "--network", `${demoProject}_default`,
    "-e", "KEYCLOAK_URL=http://keycloak:8080",
    "-e", `KEYCLOAK_ADMIN_USERNAME=${env.KEYCLOAK_ADMIN_USERNAME ?? "admin"}`,
    "-e", "KEYCLOAK_ADMIN_PASSWORD",
    "-v", `${resolve(repositoryRoot, "infra/keycloak/testing", script)}:/fixtures/${script}:ro`,
    ...extra,
    "node:22-alpine", "node", `/fixtures/${script}`,
  ], { env: { ...process.env, KEYCLOAK_ADMIN_PASSWORD: env.KEYCLOAK_ADMIN_PASSWORD }, stdio: "inherit" });
  keycloakAdmin("bootstrap-users.mjs", [
    "-e", "KEYCLOAK_TEST_USERS_FILE=/fixtures/users.json", "-v", `${usersFile}:/fixtures/users.json:ro`,
  ]);
  writeFileSync(usersFile, "[]");

  // Fails loudly if the sub-flow is missing or the change did not take; also
  // verifies the admins kept their platform-admin membership.
  keycloakAdmin("demo-admin-otp.mjs", [
    "-e", `DEMO_ADMIN_OTP=${twoFactor}`,
    "-e", `DEMO_PLATFORM_ADMINS=${USERS.filter((user) => user.platformAdmin).map((user) => user.username).join(",")}`,
  ]);
  if (twoFactor === "off") {
    writeFileSync(credentialsFile, `${JSON.stringify({ ...readCredentials(), twoFactor }, null, 2)}\n`, { mode: 0o600 });
  }
}
