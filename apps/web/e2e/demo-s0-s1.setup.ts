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
  rehearsalEnv,
  repositoryRoot,
} from "./demo-s0-s1.fixture";

/**
 * Seeds the CHG-118 provisional reference data and the three role identities
 * into the disposable rehearsal stack. Never touches any other Compose project.
 */
export default async function setupDemoRehearsal(): Promise<void> {
  if (!demoConfigured) return; // The spec skips itself without a demo stack.
  assertDisposableTarget();
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
  writeFileSync(credentialsFile, JSON.stringify(Object.fromEntries(
    USERS.map((user) => [user.key, { username: user.username, password: passwords[user.key] }]),
  ), null, 2), { mode: 0o600 });
  const usersFile = resolve(evidenceDir, "keycloak-users.json");
  writeFileSync(usersFile, JSON.stringify(users), { mode: 0o644 });

  // The Keycloak admin API is deliberately not proxied by Caddy; reach it on
  // the rehearsal's private Compose network with the rehearsal's own admin.
  const env = rehearsalEnv();
  execFileSync("docker", [
    "run", "--rm", "--network", `${demoProject}_default`,
    "-e", "KEYCLOAK_URL=http://keycloak:8080",
    "-e", `KEYCLOAK_ADMIN_USERNAME=${env.KEYCLOAK_ADMIN_USERNAME ?? "admin"}`,
    "-e", "KEYCLOAK_ADMIN_PASSWORD",
    "-e", "KEYCLOAK_TEST_USERS_FILE=/fixtures/users.json",
    "-v", `${resolve(repositoryRoot, "infra/keycloak/testing/bootstrap-users.mjs")}:/fixtures/bootstrap-users.mjs:ro`,
    "-v", `${usersFile}:/fixtures/users.json:ro`,
    "node:22-alpine", "node", "/fixtures/bootstrap-users.mjs",
  ], { env: { ...process.env, KEYCLOAK_ADMIN_PASSWORD: env.KEYCLOAK_ADMIN_PASSWORD }, stdio: "inherit" });
  writeFileSync(usersFile, "[]");
}
