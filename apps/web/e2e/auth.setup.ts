import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import pg from "pg";

import { seedAuthUsers } from "@smp/db/testing/seed-auth-users";
import {
  acquireComposeEnvironmentLock,
  runInitialOwnedCleanup,
  type ComposeEnvironmentLock,
} from "../src/lib/auth/compose-environment-lock";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd(), "../..");
const composeProject = "ledger-us004-e2e";
const ownerUrl =
  "postgresql://ledger_owner:change-me-owner@127.0.0.1:15434/ledger";
const appUrl =
  "postgresql://ledger_app:change-me-app@127.0.0.1:15434/ledger";
const webUrl = "http://localhost:3104";
const keycloakUrl = "http://127.0.0.1:18184";
const keycloakPublicOrigin = "http://keycloak.localhost:18184";

const composeArguments = [
  "compose",
  "--env-file",
  ".env.example",
  "--file",
  "infra/docker-compose.yml",
  "--file",
  "infra/docker-compose.test.yml",
];

async function compose(...args: string[]): Promise<void> {
  await execFileAsync("docker", [...composeArguments, ...args], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      APP_HOST_PORT: "3104",
      COMPOSE_PROJECT_NAME: composeProject,
      KEYCLOAK_PUBLIC_HOST: "keycloak.localhost",
      KEYCLOAK_PUBLIC_ORIGIN: keycloakPublicOrigin,
      KEYCLOAK_PUBLIC_PORT: "18184",
      POSTGRES_HOST_PORT: "15434",
    },
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function waitForUrl(url: string, label: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The real dependency is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`${label} did not become ready before the E2E deadline`);
}

async function waitForPostgres(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: ownerUrl });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch {
      await client.end().catch(() => undefined);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error("PostgreSQL did not become ready before the E2E deadline");
}

async function assertMigrationOwnerContract(): Promise<void> {
  const owner = new pg.Client({ connectionString: ownerUrl });
  try {
    await owner.connect();
    const result = await owner.query<{
      can_create_database: boolean;
      can_create_in_public: boolean;
      database_owner: string;
      schema_owner: string;
    }>(`
      SELECT
        has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_database,
        has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_public,
        pg_get_userbyid(database.datdba) AS database_owner,
        pg_get_userbyid(namespace.nspowner) AS schema_owner
      FROM pg_database database
      CROSS JOIN pg_namespace namespace
      WHERE database.datname = current_database()
        AND namespace.nspname = 'public'
    `);
    if (
      result.rows.length !== 1 ||
      result.rows[0]?.database_owner !== "ledger_owner" ||
      result.rows[0]?.schema_owner !== "pg_database_owner" ||
      !result.rows[0]?.can_create_database ||
      !result.rows[0]?.can_create_in_public
    ) {
      throw new Error("fresh PostgreSQL migration-owner contract is not effective");
    }
  } finally {
    await owner.end();
  }
}

async function cleanOwnedEnvironment(
  environmentLock: ComposeEnvironmentLock,
): Promise<void> {
  const cleanupErrors: unknown[] = [];
  try {
    await compose("down", "--volumes", "--remove-orphans");
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await environmentLock.release();
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) {
    throw new AggregateError(
      cleanupErrors,
      "Compose environment cleanup and lock release both failed",
    );
  }
}

export default async function setupAuthEnvironment() {
  const environmentLock = await acquireComposeEnvironmentLock();
  await runInitialOwnedCleanup(environmentLock, () =>
    compose("down", "--volumes", "--remove-orphans"),
  );
  try {
    await compose("up", "--detach", "postgres", "keycloak");
    await waitForUrl(
      `${keycloakUrl}/realms/corporativo`,
      "Keycloak corporativo realm",
    );
    await waitForPostgres();
    await assertMigrationOwnerContract();

    await execFileAsync(
      process.execPath,
      [resolve(repositoryRoot, "packages/db/scripts/apply-migrations.mjs")],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          DATABASE_ADMIN_URL: ownerUrl,
          DATABASE_URL: appUrl,
        },
      },
    );
    const owner = new pg.Client({ connectionString: ownerUrl });
    try {
      await owner.connect();
      await seedAuthUsers(owner);
      await owner.query(`
        INSERT INTO audit_log (
          id, actor_user_id, action, entity_type, entity_id, company_id,
          note, before, after, occurred_at
        ) VALUES (
          '20000000-0000-0000-0000-000000000810',
          '20000000-0000-0000-0000-000000000005',
          'company.updated',
          'Company',
          '20000000-0000-0000-0000-000000000451',
          '20000000-0000-0000-0000-000000000451',
          'E2E audit note',
          '{"status":"inactive"}'::jsonb,
          '{"status":"active","added":"visible"}'::jsonb,
          '2026-07-25T20:00:00Z'
        )
        ON CONFLICT (id) DO NOTHING
      `);
      await owner.query(`
        INSERT INTO vendor (
          id, name, connector_type, provisioning_protocol, can_provision,
          can_deprovision, has_usage_data, has_cost_data, identity_matching,
          status, created_at, created_by
        ) VALUES (
          '20000000-0000-0000-0000-000000000460',
          'Breadcrumb Vendor',
          'api',
          'rest',
          true,
          true,
          true,
          true,
          'email',
          'active',
          now(),
          '00000000-0000-0000-0000-000000000001'
        );
        INSERT INTO vendor_account (
          id, vendor_id, name, mode, low_pool_floor, status,
          created_at, created_by
        ) VALUES (
          '20000000-0000-0000-0000-000000000461',
          '20000000-0000-0000-0000-000000000460',
          'Claude Enterprise · Central',
          'automated',
          0,
          'active',
          now(),
          '00000000-0000-0000-0000-000000000001'
        );
        INSERT INTO license_type (
          id, vendor_id, name, unit, status, created_at, created_by
        ) VALUES (
          '20000000-0000-0000-0000-000000000462',
          '20000000-0000-0000-0000-000000000460',
          'Claude Enterprise',
          'seat',
          'active',
          now(),
          '00000000-0000-0000-0000-000000000001'
        );
        INSERT INTO license_request (
          id, request_no, person_id, company_id, vendor_account_id,
          license_type_id, state, justification, created_at, created_by
        ) VALUES (
          '20000000-0000-0000-0000-000000000463',
          'REQ-BREADCRUMB',
          '20000000-0000-0000-0000-000000000201',
          '20000000-0000-0000-0000-000000000451',
          '20000000-0000-0000-0000-000000000461',
          '20000000-0000-0000-0000-000000000462',
          'active',
          'fixture',
          now(),
          '00000000-0000-0000-0000-000000000001'
        );
        INSERT INTO statement (
          id, company_id, period, status, opening_seats, total_usd,
          generated_at, created_at
        ) VALUES (
          '20000000-0000-0000-0000-000000000464',
          '20000000-0000-0000-0000-000000000451',
          '2026-07',
          'final',
          1,
          100.00,
          now(),
          now()
        )
      `);
    } finally {
      await owner.end();
    }
    await compose("run", "--rm", "keycloak-test-bootstrap");
    await compose("up", "--detach", "--build", "app");
    try {
      await waitForUrl(`${webUrl}/login`, "Ledger web application");
    } catch (error) {
      const { stdout: logs } = await execFileAsync(
        "docker",
        [...composeArguments, "logs", "--no-color", "--tail", "100", "app"],
        {
          cwd: repositoryRoot,
          env: {
            ...process.env,
            APP_HOST_PORT: "3104",
            COMPOSE_PROJECT_NAME: composeProject,
            KEYCLOAK_PUBLIC_HOST: "keycloak.localhost",
            KEYCLOAK_PUBLIC_ORIGIN: keycloakPublicOrigin,
            KEYCLOAK_PUBLIC_PORT: "18184",
            POSTGRES_HOST_PORT: "15434",
          },
        },
      );
      throw new Error(`${String(error)}\n${logs}`);
    }
  } catch (error) {
    try {
      await cleanOwnedEnvironment(environmentLock);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Auth E2E setup failed and owned cleanup also failed",
      );
    }
    throw error;
  }

  return async () => cleanOwnedEnvironment(environmentLock);
}
