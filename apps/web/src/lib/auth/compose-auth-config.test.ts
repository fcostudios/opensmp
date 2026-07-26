import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../../../../..");

test("declares one browser-reachable Keycloak origin that is routable from the Compose app", async () => {
  const publicOrigin = "http://keycloak.localhost:18184";
  const { stdout } = await execFileAsync(
    "docker",
    [
      "compose",
      "--env-file",
      ".env.example",
      "--file",
      "infra/docker-compose.yml",
      "--file",
      "infra/docker-compose.test.yml",
      "config",
      "--format",
      "json",
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        APP_HOST_PORT: "3104",
        COMPOSE_PROJECT_NAME: "ledger-us004-compose-contract",
        KEYCLOAK_PUBLIC_HOST: "keycloak.localhost",
        KEYCLOAK_PUBLIC_ORIGIN: publicOrigin,
        KEYCLOAK_PUBLIC_PORT: "18184",
        POSTGRES_HOST_PORT: "15434",
      },
    },
  );
  const config = JSON.parse(stdout) as {
    services: {
      app: {
        environment: Record<string, string>;
        ports: Array<{ published: string; target: number }>;
      };
      keycloak: {
        environment: Record<string, string>;
        networks: Record<string, { aliases?: string[] }>;
        ports: Array<{ published: string; target: number }>;
      };
    };
  };

  expect(config.services.app.environment).toMatchObject({
    AUTH_URL: "http://localhost:3104",
    KEYCLOAK_ADMIN_BASE_URL: "http://keycloak:18184",
    KEYCLOAK_ISSUER: `${publicOrigin}/realms/corporativo`,
    NEXTAUTH_URL: "http://localhost:3104",
  });
  expect(config.services.keycloak.environment).toMatchObject({
    KC_HOSTNAME: publicOrigin,
    KC_HTTP_PORT: "18184",
  });
  expect(config.services.keycloak.ports).toEqual([
    expect.objectContaining({ published: "18184", target: 18184 }),
  ]);
  expect(config.services.app.ports).toEqual([
    expect.objectContaining({ published: "3104", target: 3000 }),
  ]);
  expect(
    Object.values(config.services.keycloak.networks).flatMap(
      ({ aliases = [] }) => aliases,
    ),
  ).toContain("keycloak.localhost");
});
