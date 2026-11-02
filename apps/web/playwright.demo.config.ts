import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "@playwright/test";

/**
 * CHG-118 demo dress rehearsal against the disposable production-shaped stack
 * (infra/production/rehearse.sh + docker-compose.rehearsal-ports.yml). Never the
 * default E2E config: it has no development globalSetup and targets HTTPS.
 *
 *   DEMO_REHEARSAL_ENV_FILE=<printed runtime.env> \
 *     pnpm --dir apps/web exec playwright test -c playwright.demo.config.ts
 *
 * CHG-121 (`pnpm demo:up`) selects the suite with DEMO_SUITE:
 *   journey  (default) seed + the S0/S1 journey, persisting admin TOTP secrets
 *   accounts seed + one sign-in per user (TOTP enrollment only; `--empty`)
 *   login    no seeding; sign in from DEMO_CREDENTIALS_FILE only (the proof)
 */
const suites = {
  journey: "demo-s0-s1.spec.ts",
  accounts: "demo-accounts.spec.ts",
  login: "demo-login.spec.ts",
} as const;
const suite = (process.env.DEMO_SUITE ?? "journey") as keyof typeof suites;
if (!(suite in suites)) throw new Error(`DEMO_SUITE must be one of ${Object.keys(suites).join(", ")}`);
const baseURL = process.env.DEMO_BASE_URL ?? "https://ledger.localhost:28443";
const { hostname: appHost, port } = new URL(baseURL);
const authHost = appHost.replace(/^ledger\./, "auth.");

/**
 * Chromium does not read the rehearsal's local CA. Validate each served chain
 * against that CA with OpenSSL, then pin exactly those leaf keys for the test
 * browser (test-only; the app itself trusts the CA via NODE_EXTRA_CA_CERTS).
 */
function verifiedLeafPins(): string[] {
  const envFile = process.env.DEMO_REHEARSAL_ENV_FILE;
  if (!envFile) return [];
  const caDir = readFileSync(envFile, "utf8").match(/^LOCAL_CA_DIR=(.*)$/m)?.[1];
  if (!caDir) throw new Error("LOCAL_CA_DIR missing from the rehearsal env file");
  return [appHost, authHost].map((host) => {
    const chain = execFileSync("openssl", ["s_client", "-connect", `127.0.0.1:${port}`, "-servername", host,
      "-CAfile", `${caDir}/root.crt`, "-verify_return_error", "-verify_hostname", host], { input: "", encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
    if (!/Verify return code: 0 \(ok\)/.test(chain)) throw new Error(`${host} does not validate against the rehearsal CA`);
    const leaf = chain.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)![0];
    const publicKey = execFileSync("openssl", ["x509", "-pubkey", "-noout"], { input: leaf });
    const der = execFileSync("openssl", ["pkey", "-pubin", "-outform", "der"], { input: publicKey });
    return execFileSync("openssl", ["dgst", "-sha256", "-binary"], { input: der }).toString("base64");
  });
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: [suites[suite]],
  // Seeding regenerates the passwords, so the login proof must never run it.
  ...(suite === "login" ? {} : { globalSetup: "./e2e/demo-s0-s1.setup.ts" }),
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  outputDir: "./test-results/demo-s0-s1/artifacts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    acceptDownloads: true,
    launchOptions: {
      args: [
        // macOS resolves *.localhost to ::1 first; Caddy binds 127.0.0.1 only.
        `--host-resolver-rules=MAP ${appHost} 127.0.0.1, MAP ${authHost} 127.0.0.1`,
        ...(process.env.DEMO_REHEARSAL_ENV_FILE ? [`--ignore-certificate-errors-spki-list=${verifiedLeafPins().join(",")}`] : []),
      ],
    },
  },
});
