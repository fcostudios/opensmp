import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../../../../..");
const credentialCryptoSource = join(
  repositoryRoot,
  "apps/web/src/modules/vendor-catalog/credential-crypto.ts",
);
const esbuildBinary = join(repositoryRoot, "apps/web/node_modules/.bin/esbuild");

type ComposeConfig = {
  services: {
    app: {
      environment: Record<string, string>;
      user?: string;
      volumes?: Array<{
        type: string;
        source: string;
        target: string;
        read_only: boolean;
        bind: { create_host_path: boolean };
      }>;
    };
  };
};

test("configures the base application stack without go-live import artifacts", async () => {
  const { stdout } = await execFileAsync(
    "docker",
    [
      "compose",
      "--env-file",
      ".env.example",
      "--file",
      "infra/docker-compose.yml",
      "config",
      "--format",
      "json",
    ],
    {
      cwd: repositoryRoot,
    },
  );
  const config = JSON.parse(stdout) as ComposeConfig;

  expect(config.services.app.environment).not.toHaveProperty(
    "LEDGER_CREDENTIAL_MANIFEST_FILE",
  );
  expect(config.services.app.environment).not.toHaveProperty(
    "LEDGER_CREDENTIAL_KEK_FILE",
  );
  expect(config.services.app.volumes ?? []).not.toEqual(expect.arrayContaining([
    expect.objectContaining({
      target: "/run/ledger-secrets/go-live-credential-manifest.json",
    }),
    expect.objectContaining({
      target: "/run/ledger-secrets/integration-credential.kek",
    }),
  ]));
});

test("injects dynamic credential variables and read-only artifacts through the import overlay", async () => {
  const privateDirectory = await mkdtemp(join(tmpdir(), "ledger-import-env-"));
  const runtimeEnvFile = join(privateDirectory, "credential-runtime.env");
  try {
    await writeFile(
      runtimeEnvFile,
      [
        "ANTHROPIC_EXAMPLE_ORG_ADMIN_KEY=synthetic-admin-key",
        "ANTHROPIC_EXAMPLE_ORG_ANALYTICS_KEY=synthetic-analytics-key",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );

    const { stdout } = await execFileAsync(
      "docker",
      [
        "compose",
        "--env-file",
        ".env.example",
        "--file",
        "infra/docker-compose.yml",
        "--file",
        "infra/docker-compose.import.yml",
        "config",
        "--format",
        "json",
      ],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          LEDGER_CREDENTIAL_RUNTIME_ENV_FILE: runtimeEnvFile,
          LEDGER_CREDENTIAL_MANIFEST_SOURCE:
            "/srv/ledger/secrets/go-live-credential-manifest.json",
          LEDGER_CREDENTIAL_KEK_SOURCE:
            "/srv/ledger/secrets/integration-credential.kek",
        },
      },
    );
    const config = JSON.parse(stdout) as ComposeConfig;

    expect(config.services.app.environment).toMatchObject({
      ANTHROPIC_EXAMPLE_ORG_ADMIN_KEY: "synthetic-admin-key",
      ANTHROPIC_EXAMPLE_ORG_ANALYTICS_KEY: "synthetic-analytics-key",
      LEDGER_CREDENTIAL_MANIFEST_FILE:
        "/run/ledger-secrets/go-live-credential-manifest.json",
      LEDGER_CREDENTIAL_KEK_FILE:
        "/run/ledger-secrets/integration-credential.kek",
    });
    expect(config.services.app.user).toBe("1001:1001");
    expect(config.services.app.volumes ?? []).toEqual(expect.arrayContaining([
      {
        type: "bind",
        source: "/srv/ledger/secrets/go-live-credential-manifest.json",
        target: "/run/ledger-secrets/go-live-credential-manifest.json",
        read_only: true,
        bind: { create_host_path: false },
      },
      {
        type: "bind",
        source: "/srv/ledger/secrets/integration-credential.kek",
        target: "/run/ledger-secrets/integration-credential.kek",
        read_only: true,
        bind: { create_host_path: false },
      },
    ]));
  } finally {
    await rm(privateDirectory, { recursive: true, force: true });
  }
});

test("the import container identity can read a root-owned 0440 KEK without write access", async () => {
  const privateDirectory = await mkdtemp(join(tmpdir(), "ledger-import-kek-"));
  const kekPath = join(privateDirectory, "integration-credential.kek");
  const entryPath = join(privateDirectory, "read-kek-entry.ts");
  const bundlePath = join(privateDirectory, "read-kek.cjs");
  const expected = Buffer.from(
    Uint8Array.from({ length: 32 }, (_, index) => index),
  ).toString("base64");
  try {
    await writeFile(kekPath, `${expected}\n`, { mode: 0o600 });
    await writeFile(
      entryPath,
      `export { readKekFile } from ${JSON.stringify(credentialCryptoSource)};\n`,
      "utf8",
    );
    await execFileAsync(esbuildBinary, [
      entryPath,
      "--bundle",
      "--platform=node",
      "--format=cjs",
      `--outfile=${bundlePath}`,
    ]);
    await execFileAsync("docker", [
      "run",
      "--rm",
      "--volume",
      `${privateDirectory}:/fixture`,
      "node:22-alpine",
      "sh",
      "-c",
      "chown 0:1001 /fixture/integration-credential.kek && chmod 0440 /fixture/integration-credential.kek",
    ]);
    const { stdout } = await execFileAsync("docker", [
      "run",
      "--rm",
      "--user",
      "1001:1001",
      "--volume",
      `${kekPath}:/run/ledger-secrets/integration-credential.kek:ro`,
      "--volume",
      `${bundlePath}:/test/read-kek.cjs:ro`,
      "node:22-alpine",
      "node",
      "-e",
      [
        "const { readKekFile } = require('/test/read-kek.cjs');",
        "const fs = require('node:fs');",
        "const path = '/run/ledger-secrets/integration-credential.kek';",
        "(async () => {",
        "const value = await readKekFile(path);",
        `if (Buffer.from(value).toString('base64') !== ${JSON.stringify(expected)}) process.exit(2);`,
        "try { fs.appendFileSync(path, 'forbidden'); process.exit(3); }",
        "catch (error) { if (!['EACCES', 'EROFS'].includes(error.code)) throw error; }",
        "})().catch((error) => { console.error(error); process.exit(4); });",
      ].join(" "),
    ]);
    expect(stdout).toBe("");
  } finally {
    await rm(privateDirectory, { recursive: true, force: true });
  }
});
