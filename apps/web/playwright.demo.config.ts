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
 * against that CA, then pin exactly those leaf keys for the test browser
 * (test-only; the app itself trusts the CA via NODE_EXTRA_CA_CERTS).
 *
 * CHG-123: verification uses Node's own TLS (the CA as the only trust root,
 * rejectUnauthorized, built-in hostname check) instead of the openssl CLI,
 * because macOS's /usr/bin/openssl (LibreSSL) has no -verify_hostname. It runs
 * in a child Node process because Playwright loads this config synchronously.
 */
const PIN_SCRIPT = `
const tls = require("node:tls");
const { X509Certificate, createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const [ca, port, ...hosts] = process.argv.slice(1);
const caPem = readFileSync(ca);
(async () => {
  const pins = [];
  for (const host of hosts) {
    pins.push(await new Promise((resolve, reject) => {
      const socket = tls.connect({ host: "127.0.0.1", port: Number(port), servername: host, ca: caPem, rejectUnauthorized: true }, () => {
        const leaf = new X509Certificate(socket.getPeerCertificate(false).raw);
        socket.end();
        resolve(createHash("sha256").update(leaf.publicKey.export({ type: "spki", format: "der" })).digest("base64"));
      });
      socket.setTimeout(15000, () => socket.destroy(new Error(host + ": TLS timeout")));
      socket.on("error", (error) => reject(new Error(host + " does not validate against the rehearsal CA: " + error.message)));
    }));
  }
  process.stdout.write(JSON.stringify(pins));
})().catch((error) => { console.error(error.message); process.exit(1); });
`;

function verifiedLeafPins(): string[] {
  const envFile = process.env.DEMO_REHEARSAL_ENV_FILE;
  if (!envFile) return [];
  const caDir = readFileSync(envFile, "utf8").match(/^LOCAL_CA_DIR=(.*)$/m)?.[1];
  if (!caDir) throw new Error("LOCAL_CA_DIR missing from the rehearsal env file");
  const output = execFileSync(process.execPath, ["-e", PIN_SCRIPT, `${caDir}/root.crt`, port, appHost, authHost], { encoding: "utf8" });
  return JSON.parse(output) as string[];
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
