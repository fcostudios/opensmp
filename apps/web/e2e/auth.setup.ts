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
const composeProject = "ledger-sprint2";
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
        INSERT INTO user_account (
          id, email, idp_subject, global_role, ui_language, status, created_at
        ) VALUES (
          '20000000-0000-0000-0000-000000000011',
          'vendor-accounts-admin@auth.test',
          NULL,
          'group_admin',
          'es',
          'active',
          now()
        )
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          idp_subject = NULL,
          global_role = EXCLUDED.global_role,
          ui_language = EXCLUDED.ui_language,
          status = EXCLUDED.status
      `);
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
          'Anthropic',
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
          id, vendor_id, name, mode, vendor_org_ref, contract_renewal_on,
          low_pool_floor, status,
          created_at, created_by
        ) VALUES (
          '20000000-0000-0000-0000-000000000461',
          '20000000-0000-0000-0000-000000000460',
          'Claude Enterprise · Central',
          'automated',
          'anthropic-central-e2e',
          '2027-04-30',
          3,
          'active',
          now(),
          '00000000-0000-0000-0000-000000000001'
        );
        INSERT INTO license_type (
          id, vendor_id, name, unit, status, created_at, created_by
        ) VALUES
          (
            '20000000-0000-0000-0000-000000000462',
            '20000000-0000-0000-0000-000000000460',
            'Claude Enterprise',
            'seat',
            'active',
            now(),
            '00000000-0000-0000-0000-000000000001'
          ),
          (
            '20000000-0000-0000-0000-000000000468',
            '20000000-0000-0000-0000-000000000460',
            'Claude Legacy',
            'license',
            'inactive',
            now(),
            '00000000-0000-0000-0000-000000000001'
          );
        INSERT INTO rate_card (
          id, vendor_account_id, license_type_id, monthly_rate_usd,
          effective_from, effective_to, created_at, created_by
        ) VALUES
          (
            '20000000-0000-0000-0000-000000000465',
            '20000000-0000-0000-0000-000000000461',
            '20000000-0000-0000-0000-000000000462',
            49.00,
            '2026-01-01',
            NULL,
            now(),
            '00000000-0000-0000-0000-000000000001'
          ),
          (
            '20000000-0000-0000-0000-000000000469',
            '20000000-0000-0000-0000-000000000461',
            '20000000-0000-0000-0000-000000000462',
            99.00,
            '2099-01-01',
            NULL,
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
        INSERT INTO person (
          id, email, full_name, company_id, status, created_at, created_by
        ) VALUES
          (
            '20000000-0000-0000-0000-000000000821',
            'vendor.assigned@e2e.test',
            'Vendor Assigned Fixture',
            '20000000-0000-0000-0000-000000000451',
            'active',
            '2026-08-01T12:00:00Z',
            '00000000-0000-0000-0000-000000000001'
          ),
          (
            '20000000-0000-0000-0000-000000000822',
            'vendor.pending@e2e.test',
            'Vendor Pending Fixture',
            '20000000-0000-0000-0000-000000000451',
            'active',
            '2026-08-01T12:00:00Z',
            '00000000-0000-0000-0000-000000000001'
          );
        INSERT INTO vendor_account_capacity (
          id, vendor_account_id, license_type_id, purchased_qty,
          effective_from, note, created_at, created_by
        ) VALUES (
          '20000000-0000-0000-0000-000000000820',
          '20000000-0000-0000-0000-000000000461',
          '20000000-0000-0000-0000-000000000462',
          8,
          '2026-01-01',
          'US-025 deterministic acceptance capacity',
          '2026-08-01T12:00:00Z',
          '00000000-0000-0000-0000-000000000001'
        );
        INSERT INTO license_assignment (
          id, person_id, company_id, vendor_account_id, license_type_id,
          started_on, source_kind, note, created_at, created_by
        ) VALUES (
          '20000000-0000-0000-0000-000000000823',
          '20000000-0000-0000-0000-000000000821',
          '20000000-0000-0000-0000-000000000451',
          '20000000-0000-0000-0000-000000000461',
          '20000000-0000-0000-0000-000000000462',
          '2026-01-01',
          'import',
          'US-025 deterministic assigned seat',
          '2026-08-01T12:00:00Z',
          '00000000-0000-0000-0000-000000000001'
        );
        INSERT INTO license_request (
          id, request_no, person_id, company_id, vendor_account_id,
          license_type_id, state, justification, created_at, created_by
        ) VALUES (
          '20000000-0000-0000-0000-000000000824',
          'REQ-US025-PENDING',
          '20000000-0000-0000-0000-000000000822',
          '20000000-0000-0000-0000-000000000451',
          '20000000-0000-0000-0000-000000000461',
          '20000000-0000-0000-0000-000000000462',
          'provisioning',
          'US-025 deterministic pending invitation',
          '2026-08-01T12:00:00Z',
          '00000000-0000-0000-0000-000000000001'
        );
        INSERT INTO provisioning_action (
          id, request_id, vendor_account_id, kind, mode, status, created_at
        ) VALUES (
          '20000000-0000-0000-0000-000000000825',
          '20000000-0000-0000-0000-000000000824',
          '20000000-0000-0000-0000-000000000461',
          'invite',
          'automated',
          'pending',
          '2026-08-01T12:00:00Z'
        );
        INSERT INTO integration_credential (
          id, vendor_account_id, kind, encrypted_secret, health, status,
          created_at, created_by
        ) VALUES (
          '20000000-0000-0000-0000-000000000826',
          '20000000-0000-0000-0000-000000000461',
          'admin_scoped',
          'e2e-not-a-production-secret',
          'ok',
          'active',
          '2026-08-01T12:00:00Z',
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
      await owner.query(`
        UPDATE company
        SET budget_monthly_usd = 10000.00
        WHERE id = '20000000-0000-0000-0000-000000000451';

        INSERT INTO company (
          id, name, code, type, status, budget_monthly_usd, created_at, created_by
        ) VALUES (
          '20000000-0000-0000-0000-000000000480',
          'Out of Scope Company',
          'OUT-SCOPE',
          'internal',
          'active',
          10000.00,
          '2026-07-01T12:00:00Z',
          '00000000-0000-0000-0000-000000000001'
        );

        INSERT INTO vendor (
          id, name, connector_type, provisioning_protocol, can_provision,
          can_deprovision, has_usage_data, has_cost_data, identity_matching,
          status, created_at, created_by
        ) VALUES (
          '20000000-0000-0000-0000-000000000470',
          'Sprint 2 Orchestration Vendor',
          'orchestration',
          'none',
          false,
          false,
          false,
          false,
          'email',
          'active',
          '2026-07-01T12:00:00Z',
          '00000000-0000-0000-0000-000000000001'
        );
        INSERT INTO vendor_account (
          id, vendor_id, name, mode, low_pool_floor, status,
          created_at, created_by
        ) VALUES (
          '20000000-0000-0000-0000-000000000471',
          '20000000-0000-0000-0000-000000000470',
          'Sprint 2 Orchestration Pool',
          'orchestration',
          1,
          'active',
          '2026-07-01T12:00:00Z',
          '00000000-0000-0000-0000-000000000001'
        );
        INSERT INTO license_type (
          id, vendor_id, name, unit, status, created_at, created_by
        ) VALUES (
          '20000000-0000-0000-0000-000000000472',
          '20000000-0000-0000-0000-000000000470',
          'Sprint 2 Seat',
          'seat',
          'active',
          '2026-07-01T12:00:00Z',
          '00000000-0000-0000-0000-000000000001'
        );
        INSERT INTO vendor_account_capacity (
          id, vendor_account_id, license_type_id, purchased_qty, effective_from,
          note, created_at, created_by
        ) VALUES (
          '20000000-0000-0000-0000-000000000473',
          '20000000-0000-0000-0000-000000000471',
          '20000000-0000-0000-0000-000000000472',
          5,
          '2026-01-01',
          'Deterministic Sprint 2 E2E capacity',
          '2026-07-01T12:00:00Z',
          '00000000-0000-0000-0000-000000000001'
        );

        INSERT INTO person (
          id, email, full_name, company_id, status, created_at, created_by
        ) VALUES
          (
            '20000000-0000-0000-0000-000000000481',
            'foreign.employee@scope.test',
            'Foreign Scope Employee',
            '20000000-0000-0000-0000-000000000480',
            'active',
            '2026-07-01T12:00:00Z',
            '00000000-0000-0000-0000-000000000001'
          ),
          (
            '20000000-0000-0000-0000-000000000483',
            'rejection.fixture@auth.test',
            'Rejection Fixture',
            '20000000-0000-0000-0000-000000000451',
            'active',
            '2026-07-01T12:00:00Z',
            '00000000-0000-0000-0000-000000000001'
          ),
          (
            '20000000-0000-0000-0000-000000000485',
            'mismatch.fixture@auth.test',
            'Mismatch Fixture',
            '20000000-0000-0000-0000-000000000451',
            'active',
            '2026-07-01T12:00:00Z',
            '00000000-0000-0000-0000-000000000001'
          );

        INSERT INTO license_request (
          id, request_no, person_id, company_id, vendor_account_id,
          license_type_id, state, justification, requested_by, created_at,
          created_by, updated_at
        ) VALUES
          (
            '20000000-0000-0000-0000-000000000482',
            'SOL-E2E-SCOPE',
            '20000000-0000-0000-0000-000000000481',
            '20000000-0000-0000-0000-000000000480',
            '20000000-0000-0000-0000-000000000471',
            '20000000-0000-0000-0000-000000000472',
            'pending_approval',
            'Cross-company approval scope fixture',
            '20000000-0000-0000-0000-000000000005',
            '2026-07-28T12:00:00Z',
            '00000000-0000-0000-0000-000000000001',
            '2026-07-28T12:00:00Z'
          ),
          (
            '20000000-0000-0000-0000-000000000484',
            'SOL-E2E-REJECT',
            '20000000-0000-0000-0000-000000000483',
            '20000000-0000-0000-0000-000000000451',
            '20000000-0000-0000-0000-000000000471',
            '20000000-0000-0000-0000-000000000472',
            'pending_approval',
            'Rejection comment fixture',
            '20000000-0000-0000-0000-000000000005',
            '2026-07-28T12:01:00Z',
            '00000000-0000-0000-0000-000000000001',
            '2026-07-28T12:01:00Z'
          ),
          (
            '20000000-0000-0000-0000-000000000486',
            'SOL-E2E-MISMATCH',
            '20000000-0000-0000-0000-000000000485',
            '20000000-0000-0000-0000-000000000451',
            '20000000-0000-0000-0000-000000000471',
            '20000000-0000-0000-0000-000000000472',
            'active',
            'Later verification mismatch fixture',
            '20000000-0000-0000-0000-000000000005',
            '2026-07-20T12:00:00Z',
            '00000000-0000-0000-0000-000000000001',
            '2026-07-21T12:00:00Z'
          );

        INSERT INTO license_assignment (
          id, person_id, company_id, vendor_account_id, license_type_id,
          started_on, source_request_id, source_kind, note, created_at, created_by
        ) VALUES (
          '20000000-0000-0000-0000-000000000487',
          '20000000-0000-0000-0000-000000000485',
          '20000000-0000-0000-0000-000000000451',
          '20000000-0000-0000-0000-000000000471',
          '20000000-0000-0000-0000-000000000472',
          '2026-07-20',
          '20000000-0000-0000-0000-000000000486',
          'request',
          'Assignment retained after member-sync mismatch',
          '2026-07-20T12:00:00Z',
          '20000000-0000-0000-0000-000000000005'
        );
        UPDATE license_request
        SET license_assignment_id = '20000000-0000-0000-0000-000000000487'
        WHERE id = '20000000-0000-0000-0000-000000000486';

        INSERT INTO provisioning_action (
          id, request_id, vendor_account_id, kind, mode, status, failure_reason,
          raw_request, sent_at, resolved_at, created_at
        ) VALUES (
          '20000000-0000-0000-0000-000000000488',
          '20000000-0000-0000-0000-000000000486',
          '20000000-0000-0000-0000-000000000471',
          'checklist',
          'orchestration',
          'verification_failed',
          'checklist_assignment_missing|Member synchronization did not find the attested active assignment.',
          '{
            "version": 1,
            "operation": "provision",
            "protocol": "none",
            "context": {"companyId": "20000000-0000-0000-0000-000000000451"},
            "instruction": {
              "requestId": "20000000-0000-0000-0000-000000000486",
              "vendorAccountId": "20000000-0000-0000-0000-000000000471",
              "personEmail": "mismatch.fixture@auth.test",
              "licenseTypeName": "Sprint 2 Seat"
            },
            "checklistSteps": [{
              "messageKey": "connector.manual.confirm_execution",
              "params": {
                "personEmail": "mismatch.fixture@auth.test",
                "licenseTypeName": "Sprint 2 Seat"
              },
              "targets": {
                "requestId": "20000000-0000-0000-0000-000000000486",
                "vendorAccountId": "20000000-0000-0000-0000-000000000471",
                "personId": "20000000-0000-0000-0000-000000000485",
                "licenseId": "20000000-0000-0000-0000-000000000472"
              }
            }]
          }'::jsonb,
          '2026-07-20T12:05:00Z',
          '2026-07-21T12:00:00Z',
          '2026-07-20T12:05:00Z'
        );

        INSERT INTO alert_event (
          id, alert_rule_id, fired_at, subject_ref, notified, dedupe_key
        )
        SELECT
          '20000000-0000-0000-0000-000000000489',
          rule.id,
          '2026-07-21T12:00:00Z',
          '{
            "actionId": "20000000-0000-0000-0000-000000000488",
            "companyId": "20000000-0000-0000-0000-000000000451",
            "exception": "checklist_verification_failed",
            "source": "member_sync"
          }'::jsonb,
          '{"status": "pending"}'::jsonb,
          'sprint2-e2e-mismatch'
        FROM alert_rule rule
        WHERE rule.type = 'provisioning_failure'
          AND rule.scope_kind = 'global';

        INSERT INTO audit_log (
          id, actor_user_id, action, entity_type, entity_id, company_id,
          before, after, occurred_at
        ) VALUES
          (
            '20000000-0000-0000-0000-000000000490',
            '20000000-0000-0000-0000-000000000005',
            'orchestration.checklist_confirmed',
            'ProvisioningAction',
            '20000000-0000-0000-0000-000000000488',
            '20000000-0000-0000-0000-000000000451',
            '{"status": "pending"}'::jsonb,
            '{
              "status": "confirmed",
              "assignmentId": "20000000-0000-0000-0000-000000000487",
              "confirmationId": "sprint2-e2e-confirmation"
            }'::jsonb,
            '2026-07-20T12:10:00Z'
          ),
          (
            '20000000-0000-0000-0000-000000000491',
            NULL,
            'orchestration.checklist_observed',
            'ProvisioningAction',
            '20000000-0000-0000-0000-000000000488',
            '20000000-0000-0000-0000-000000000451',
            '{"status": "confirmed"}'::jsonb,
            '{
              "status": "verification_failed",
              "source": "member_sync",
              "observationId": "sprint2-e2e-observation",
              "observedAssigned": false,
              "observedAt": "2026-07-21T12:00:00.000Z"
            }'::jsonb,
            '2026-07-21T12:00:00Z'
          );
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
