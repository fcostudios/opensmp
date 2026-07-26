import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../../../../..");

test("mounts the go-live credential manifest and KEK read-only at the declared app paths", async () => {
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
      env: {
        ...process.env,
        LEDGER_CREDENTIAL_MANIFEST_SOURCE:
          "/srv/ledger/secrets/go-live-credential-manifest.json",
        LEDGER_CREDENTIAL_KEK_SOURCE:
          "/srv/ledger/secrets/integration-credential.kek",
      },
    },
  );
  const config = JSON.parse(stdout) as {
    services: {
      app: {
        environment: Record<string, string>;
        volumes: Array<{
          type: string;
          source: string;
          target: string;
          read_only: boolean;
          bind: { create_host_path: boolean };
        }>;
      };
    };
  };

  expect(config.services.app.environment).toMatchObject({
    LEDGER_CREDENTIAL_MANIFEST_FILE:
      "/run/ledger-secrets/go-live-credential-manifest.json",
    LEDGER_CREDENTIAL_KEK_FILE:
      "/run/ledger-secrets/integration-credential.kek",
  });
  expect(config.services.app.volumes).toEqual(expect.arrayContaining([
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
});
