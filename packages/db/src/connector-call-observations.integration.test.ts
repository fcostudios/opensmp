import { afterEach, describe, expect, test, vi } from "vitest";
import type { Client } from "pg";
import { getTableName } from "drizzle-orm";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";

import { createConnectorCallObservationSession } from "@smp/connectors/connector-call-observation";
import {
  createPostgresFixture,
  type PostgresFixture,
} from "./testing/postgres-container.js";

const fixtures: PostgresFixture[] = [];
const dialect = new PgDialect();
const systemUserId = "00000000-0000-0000-0000-000000000001";
const ids = {
  company: "60000000-0000-4000-8000-000000000001",
  person: "60000000-0000-4000-8000-000000000002",
  vendor: "60000000-0000-4000-8000-000000000003",
  account: "60000000-0000-4000-8000-000000000004",
  otherAccount: "60000000-0000-4000-8000-000000000005",
  licenseType: "60000000-0000-4000-8000-000000000006",
  request: "60000000-0000-4000-8000-000000000007",
  action: "60000000-0000-4000-8000-000000000008",
  correlation: "60000000-0000-4000-8000-000000000009",
  invalidAccount: "60000000-0000-4000-8000-000000000010",
  visibleCorrelation: "60000000-0000-4000-8000-000000000020",
  clientFailureCorrelation: "60000000-0000-4000-8000-000000000021",
  providerFailureCorrelation: "60000000-0000-4000-8000-000000000022",
  retryCorrelation: "60000000-0000-4000-8000-000000000023",
  ambiguousCorrelation: "60000000-0000-4000-8000-000000000024",
  requestedFailureCorrelation: "60000000-0000-4000-8000-000000000025",
  terminalFailureCorrelation: "60000000-0000-4000-8000-000000000026",
  otherCompany: "60000000-0000-4000-8000-000000000030",
  otherPerson: "60000000-0000-4000-8000-000000000031",
  otherRequest: "60000000-0000-4000-8000-000000000032",
  otherAction: "60000000-0000-4000-8000-000000000033",
  integrityCorrelation: "60000000-0000-4000-8000-000000000034",
  otherCorrelation: "60000000-0000-4000-8000-000000000035",
  syncCorrelation: "60000000-0000-4000-8000-000000000036",
} as const;

const occurredAt = new Date("2026-09-06T12:34:56.000Z");
const providerObservationModuleSpecifier =
  "@smp/connectors/providers/anthropic/observation";
const providerRequestModuleUrl = new URL(
  "../../connectors/src/providers/anthropic/request.ts",
  import.meta.url,
).href;
const providerRateLimiterModuleUrl = new URL(
  "../../connectors/src/providers/anthropic/rate-limiter.ts",
  import.meta.url,
).href;
const anthropicCredentials = [
  {
    vendorAccountId: ids.account,
    kind: "admin_scoped",
    secret: "admin-secret",
    status: "active",
    health: "ok",
  },
  {
    vendorAccountId: ids.account,
    kind: "analytics",
    secret: "analytics-secret",
    status: "active",
    health: "ok",
  },
] as const;

type ConnectorCallObservationModule =
  typeof import("@smp/db/connector-call-observations");
type JournalAppend = ReturnType<
  ConnectorCallObservationModule["createConnectorCallObservationAppender"]
>["append"];

async function loadConnectorCallObservations(): Promise<ConnectorCallObservationModule> {
  vi.resetModules();
  return import("@smp/db/connector-call-observations");
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(async (fixture) => {
    const owner = await fixture.connectAsOwner();
    try {
      await owner.query(
        `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid()`,
      );
    } finally {
      await owner.end();
    }
    await fixture.stop();
  }));
});

async function seedObservationContext(fixture: PostgresFixture): Promise<void> {
  const owner = await fixture.connectAsOwner();
  try {
    await owner.query(
      `INSERT INTO company (id, name, code, type, status, created_at, created_by)
       VALUES ($1, 'Journal Company', 'JOURNAL', 'internal', 'active', now(), $2)`,
      [ids.company, systemUserId],
    );
    await owner.query(
      `INSERT INTO person (id, email, full_name, company_id, status, created_at, created_by)
       VALUES ($1, 'journal@example.test', 'Journal Person', $2, 'active', now(), $3)`,
      [ids.person, ids.company, systemUserId],
    );
    await owner.query(
      `INSERT INTO vendor (id, name, connector_type, provisioning_protocol, can_provision,
         can_deprovision, has_usage_data, has_cost_data, identity_matching, status, created_at, created_by)
       VALUES ($1, 'Journal Vendor', 'api', 'rest', true, true, true, true, 'email', 'active', now(), $2)`,
      [ids.vendor, systemUserId],
    );
    for (const [id, name] of [[ids.account, "Journal Account"], [ids.otherAccount, "Other Account"]] as const) {
      await owner.query(
        `INSERT INTO vendor_account (id, vendor_id, name, mode, low_pool_floor, status, created_at, created_by)
         VALUES ($1, $2, $3, 'automated', 0, 'active', now(), $4)`,
        [id, ids.vendor, name, systemUserId],
      );
    }
    await owner.query(
      `INSERT INTO license_type (id, vendor_id, name, unit, status, created_at, created_by)
       VALUES ($1, $2, 'Journal Seat', 'seat', 'active', now(), $3)`,
      [ids.licenseType, ids.vendor, systemUserId],
    );
    await owner.query(
      `INSERT INTO license_request (id, request_no, person_id, company_id, vendor_account_id,
         license_type_id, state, justification, created_at, created_by)
       VALUES ($1, 'REQ-JOURNAL', $2, $3, $4, $5, 'active', 'fixture', now(), $6)`,
      [ids.request, ids.person, ids.company, ids.account, ids.licenseType, systemUserId],
    );
    await owner.query(
      `INSERT INTO provisioning_action (id, request_id, vendor_account_id, kind, mode, status, created_at)
       VALUES ($1, $2, $3, 'invite', 'automated', 'pending', now())`,
      [ids.action, ids.request, ids.account],
    );
  } finally {
    await owner.end();
  }
}

function requested(overrides: Record<string, unknown> = {}) {
  return {
    vendorAccountId: ids.account,
    provisioningActionId: ids.action,
    correlationId: ids.correlation,
    operation: "provision" as const,
    attempt: 1,
    phase: "requested" as const,
    classification: null,
    summary: { endpoint_class: "organization" as const, method: "POST" as const },
    occurredAt,
    ...overrides,
  };
}

function createJournaledAnthropicExecutor(input: Readonly<{
  append: JournalAppend;
  correlationId: string;
  createObservationBridge: (
    session: ReturnType<typeof createConnectorCallObservationSession>,
  ) => (observation: unknown) => Promise<void>;
  createRateLimiter: (dependencies: Readonly<{
    clock: Readonly<{ now(): number }>;
    sleep(milliseconds: number): Promise<void>;
  }>) => Readonly<{
    acquire(vendorAccountId: string, budgets: readonly string[]): Promise<void>;
  }>;
  createRequestExecutor: (dependencies: Readonly<{
    clock: Readonly<{ now(): number }>;
    sleep(milliseconds: number): Promise<void>;
    limiter: Readonly<{
      acquire(vendorAccountId: string, budgets: readonly string[]): Promise<void>;
    }>;
    observe: (observation: unknown) => Promise<void>;
    transport(request: Request): Promise<Response>;
  }>) => (request: Readonly<Record<string, unknown>>) => Promise<unknown>;
  operation?: "provision" | "sync_members";
  provisioningActionId?: string | null;
  transport: (request: Request) => Promise<Response>;
}>) {
  const session = createConnectorCallObservationSession({
    vendorAccountId: ids.account,
    provisioningActionId: input.provisioningActionId ?? null,
    operation: input.operation ?? "sync_members",
    clock: () => occurredAt,
    randomId: () => input.correlationId,
    append: input.append,
  });
  const bridge = input.createObservationBridge(session);
  const clock = { now: () => occurredAt.getTime() };
  const sleep = async () => undefined;

  return input.createRequestExecutor({
    clock,
    sleep,
    limiter: input.createRateLimiter({ clock, sleep }),
    observe: bridge,
    transport: input.transport,
  });
}

async function persistedLifecycle(
  connection: Client,
  correlationId: string,
): Promise<Array<{
  attempt: number;
  phase: string;
  classification: string | null;
  summary: unknown;
}>> {
  return (await connection.query<{
    attempt: number;
    phase: string;
    classification: string | null;
    summary: unknown;
  }>(
    `SELECT attempt, phase, classification, summary
       FROM connector_call_observation
      WHERE correlation_id = $1
      ORDER BY attempt, CASE phase WHEN 'requested' THEN 0 ELSE 1 END`,
    [correlationId],
  )).rows;
}

function renderJournalSql(value: Parameters<PgDialect["sqlToQuery"]>[0]): string {
  return dialect.sqlToQuery(value).sql
    .replaceAll('"connector_call_observation".', "")
    .replaceAll('"', "")
    .replace(/\s+/g, " ")
    .trim();
}

describe("US-057 PostgreSQL connector-call observation appender", () => {
  test("exposes the canonical journal Drizzle contract", async () => {
    const { connectorCallObservation } = await loadConnectorCallObservations();
    const config = getTableConfig(connectorCallObservation);
    expect(config.columns.map((column) => [
      column.name,
      column.getSQLType(),
      column.notNull,
      column.hasDefault,
    ])).toEqual([
      ["id", "uuid", true, true],
      ["vendor_account_id", "uuid", true, false],
      ["provisioning_action_id", "uuid", false, false],
      ["correlation_id", "uuid", true, false],
      ["operation", "connector_call_operation_enum", true, false],
      ["attempt", "integer", true, false],
      ["phase", "connector_call_phase_enum", true, false],
      ["classification", "text", false, false],
      ["summary", "jsonb", true, false],
      ["occurred_at", "timestamp with time zone", true, false],
    ]);
    expect(config.foreignKeys.map((key) => [
      key.reference().columns.map(({ name }) => name),
      getTableName(key.reference().foreignTable),
    ])).toEqual([
      [["vendor_account_id"], "vendor_account"],
      [["provisioning_action_id"], "provisioning_action"],
    ]);
    expect(config.uniqueConstraints.map(({ columns, name }) => [
      name,
      columns.map((column) => column.name),
    ])).toEqual([
      ["uq_connector_call_phase", ["correlation_id", "attempt", "phase"]],
    ]);
    expect(config.checks.map(({ name, value }) => [
      name,
      renderJournalSql(value),
    ])).toEqual([
      ["connector_call_attempt_check", "attempt >= 1"],
      ["connector_call_summary_check", "jsonb_typeof(summary) = 'object'"],
      ["connector_call_classification_check", "(phase = 'requested' AND classification IS NULL) OR (phase = 'succeeded' AND classification IS NOT NULL AND classification = 'success') OR (phase = 'failed' AND classification IS NOT NULL AND classification IN ('rate_limited', 'provider_error', 'client_error'))"],
      ["connector_call_sync_action_check", "operation IN ('provision', 'deprovision') OR provisioning_action_id IS NULL"],
    ]);
    expect(config.indexes.map(({ config: index }) => [
      index.name,
      index.columns.map((column) => "name" in column ? column.name : undefined),
      index.unique,
      index.where ? renderJournalSql(index.where) : null,
    ])).toEqual([
      ["uq_connector_call_terminal", ["correlation_id", "attempt"], true, "phase IN ('succeeded', 'failed')"],
      ["idx_connector_call_vendor_account", ["vendor_account_id"], false, null],
      ["idx_connector_call_action", ["provisioning_action_id"], false, null],
      ["idx_connector_call_correlation", ["correlation_id"], false, null],
      ["idx_connector_call_operation", ["operation"], false, null],
      ["idx_connector_call_occurred_at", ["occurred_at"], false, null],
    ]);
    expect(connectorCallObservation.operation.enumValues).toEqual([
      "provision",
      "deprovision",
      "sync_members",
      "sync_activity",
      "sync_cost",
    ]);
    expect(connectorCallObservation.phase.enumValues).toEqual([
      "requested",
      "succeeded",
      "failed",
    ]);
  });

  test("commits exact requested and succeeded evidence and leaves every invalid journal mutation rejected", async () => {
    const { createConnectorCallObservationAppender } =
      await loadConnectorCallObservations();
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    await seedObservationContext(fixture);
    const journal = createConnectorCallObservationAppender(fixture.appUrl);
    const owner = await fixture.connectAsOwner();
    const app = await fixture.connectAsApp();
    let journalClosed = false;
    try {
      await journal.append(requested({
        summary: {
          endpoint_class: "organization",
          method: "POST",
          authorization: "authorization-sentinel",
          email: "email-sentinel",
          body: { secret: "body-sentinel" },
        },
      }) as never);
      expect((await owner.query(
        "SELECT count(*)::int AS count FROM connector_call_observation WHERE correlation_id = $1",
        [ids.correlation],
      )).rows).toEqual([{ count: 1 }]);
      await journal.append({
        ...requested(),
        phase: "succeeded",
        classification: "success",
        summary: {
          endpoint_class: "organization",
          method: "POST",
          http_status: 201,
          status_class: "success",
        },
      });

      const persisted = await owner.query<{
        attempt: number;
        classification: string | null;
        correlation_id: string;
        occurred_at: Date;
        operation: string;
        phase: string;
        provisioning_action_id: string | null;
        summary: unknown;
        vendor_account_id: string;
      }>(
        `SELECT vendor_account_id, provisioning_action_id, correlation_id, operation, attempt,
                phase, classification, summary, occurred_at
           FROM connector_call_observation
          WHERE correlation_id = $1
          ORDER BY attempt, phase`,
        [ids.correlation],
      );
      expect(persisted.rows).toEqual([
        {
          vendor_account_id: ids.account,
          provisioning_action_id: ids.action,
          correlation_id: ids.correlation,
          operation: "provision",
          attempt: 1,
          phase: "requested",
          classification: null,
          summary: { endpoint_class: "organization", method: "POST" },
          occurred_at: occurredAt,
        },
        {
          vendor_account_id: ids.account,
          provisioning_action_id: ids.action,
          correlation_id: ids.correlation,
          operation: "provision",
          attempt: 1,
          phase: "succeeded",
          classification: "success",
          summary: {
            endpoint_class: "organization",
            method: "POST",
            http_status: 201,
            status_class: "success",
          },
          occurred_at: occurredAt,
        },
      ]);
      expect(JSON.stringify(persisted.rows)).not.toContain("sentinel");

      await expect(journal.append(requested({
        vendorAccountId: ids.invalidAccount,
        provisioningActionId: null,
        operation: "sync_members",
        correlationId: "60000000-0000-4000-8000-000000000011",
      }) as never)).rejects.toMatchObject({ code: "23503" });
      await expect(journal.append(requested({
        vendorAccountId: ids.otherAccount,
        correlationId: "60000000-0000-4000-8000-000000000012",
      }) as never)).rejects.toMatchObject({ code: "23514" });
      await expect(journal.append(requested({
        operation: "sync_members",
        correlationId: "60000000-0000-4000-8000-000000000013",
      }) as never)).rejects.toMatchObject({ code: "23514" });
      await expect(journal.append(requested({
        attempt: 2,
        correlationId: "60000000-0000-4000-8000-000000000014",
      }) as never)).rejects.toMatchObject({ code: "23514" });
      await expect(journal.append(requested({
        phase: "failed",
        classification: "provider_error",
        correlationId: "60000000-0000-4000-8000-000000000015",
      }) as never)).rejects.toThrowError("Invalid connector classification");
      await expect(journal.append(requested({
        phase: "failed",
        classification: "provider_error",
      }) as never)).rejects.toThrowError("Invalid connector classification");
      await expect(app.query("UPDATE connector_call_observation SET summary = '{}'::jsonb")).rejects.toMatchObject({ code: "42501" });
      await expect(app.query("DELETE FROM connector_call_observation")).rejects.toMatchObject({ code: "42501" });
      await journal.close();
      journalClosed = true;
      await expect(journal.append(requested())).rejects.toThrowError(
        "Cannot use a pool after calling end on the pool",
      );
    } finally {
      await Promise.all([
        journalClosed || typeof journal?.close !== "function"
          ? undefined
          : journal.close(),
        owner.end(),
        app.end(),
      ]);
    }
  }, 150_000);

  test("enforces immutable sequential account-bound and tenant-attributable evidence", async () => {
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    await seedObservationContext(fixture);
    const owner = await fixture.connectAsOwner();
    const app = await fixture.connectAsApp();
    const insert = (overrides: Record<string, unknown> = {}) => {
      const row = {
        vendor_account_id: ids.account,
        provisioning_action_id: ids.action,
        correlation_id: ids.integrityCorrelation,
        operation: "provision",
        attempt: 1,
        phase: "requested",
        classification: null,
        summary: "{}",
        occurred_at: occurredAt,
        ...overrides,
      };
      return app.query(
        `INSERT INTO connector_call_observation (${Object.keys(row).join(",")})
         VALUES (${Object.keys(row).map((_, index) => `$${index + 1}`).join(",")})
         RETURNING attempt, phase`,
        Object.values(row),
      );
    };

    try {
      for (const invalid of [
        { attempt: 0 },
        { attempt: 2 },
        { phase: "succeeded", classification: "success" },
        { classification: "success" },
        { summary: "[]" },
        { summary: "null" },
        { operation: "sync_members" },
        { vendor_account_id: ids.otherAccount },
      ]) {
        await expect(insert(invalid)).rejects.toMatchObject({ code: "23514" });
      }

      await expect(insert()).resolves.toMatchObject({
        rows: [{ attempt: 1, phase: "requested" }],
      });
      for (const invalid of [
        { attempt: 3 },
        { attempt: 2, operation: "deprovision" },
        { attempt: 2, provisioning_action_id: null },
        {
          attempt: 2,
          provisioning_action_id: null,
          vendor_account_id: ids.otherAccount,
        },
        { phase: "succeeded", classification: null },
        { phase: "succeeded", classification: "provider_error" },
        { phase: "failed", classification: "success" },
        { phase: "failed", classification: "unknown" },
      ]) {
        await expect(insert(invalid)).rejects.toMatchObject({ code: "23514" });
      }
      await expect(insert()).rejects.toMatchObject({ code: "23514" });
      await expect(insert({
        phase: "failed",
        classification: "rate_limited",
      })).resolves.toMatchObject({ rows: [{ attempt: 1, phase: "failed" }] });
      await expect(insert({
        phase: "succeeded",
        classification: "success",
      })).rejects.toMatchObject({ code: "23514" });
      await expect(insert({ attempt: 2 })).resolves.toMatchObject({
        rows: [{ attempt: 2, phase: "requested" }],
      });
      await expect(insert({
        attempt: 2,
        phase: "succeeded",
        classification: "success",
      })).resolves.toMatchObject({
        rows: [{ attempt: 2, phase: "succeeded" }],
      });
      await expect(insert({
        correlation_id: ids.syncCorrelation,
        operation: "sync_cost",
        provisioning_action_id: null,
      })).resolves.toMatchObject({
        rows: [{ attempt: 1, phase: "requested" }],
      });

      await owner.query(
        `INSERT INTO company (id, name, code, type, status, created_at, created_by)
         VALUES ($1, 'Other Journal Company', 'JOURNAL-OTHER', 'internal', 'active', now(), $2)`,
        [ids.otherCompany, systemUserId],
      );
      await owner.query(
        `INSERT INTO person (id, email, full_name, company_id, status, created_at, created_by)
         VALUES ($1, 'other-journal@example.test', 'Other Journal Person', $2, 'active', now(), $3)`,
        [ids.otherPerson, ids.otherCompany, systemUserId],
      );
      await owner.query(
        `INSERT INTO license_request (id, request_no, person_id, company_id, vendor_account_id,
           license_type_id, state, justification, created_at, created_by)
         VALUES ($1, 'REQ-JOURNAL-OTHER', $2, $3, $4, $5, 'active', 'fixture', now(), $6)`,
        [
          ids.otherRequest,
          ids.otherPerson,
          ids.otherCompany,
          ids.otherAccount,
          ids.licenseType,
          systemUserId,
        ],
      );
      await owner.query(
        `INSERT INTO provisioning_action
           (id, request_id, vendor_account_id, kind, mode, status, created_at)
         VALUES ($1, $2, $3, 'invite', 'automated', 'pending', now())`,
        [ids.otherAction, ids.otherRequest, ids.otherAccount],
      );
      await expect(insert({
        correlation_id: ids.otherCorrelation,
        provisioning_action_id: ids.otherAction,
      })).rejects.toMatchObject({ code: "23514" });
      await expect(insert({
        correlation_id: ids.otherCorrelation,
        provisioning_action_id: ids.otherAction,
        vendor_account_id: ids.otherAccount,
      })).resolves.toMatchObject({
        rows: [{ attempt: 1, phase: "requested" }],
      });

      const attributedTo = async (companyId: string) =>
        (await app.query<{ correlation_id: string }>(
          `SELECT DISTINCT observation.correlation_id
             FROM connector_call_observation observation
             JOIN provisioning_action action
               ON action.id = observation.provisioning_action_id
             JOIN license_request request ON request.id = action.request_id
            WHERE request.company_id = $1
            ORDER BY observation.correlation_id`,
          [companyId],
        )).rows;
      expect(await attributedTo(ids.company)).toEqual([
        { correlation_id: ids.integrityCorrelation },
      ]);
      expect(await attributedTo(ids.otherCompany)).toEqual([
        { correlation_id: ids.otherCorrelation },
      ]);

      const appPid = (await app.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      )).rows[0]!.pid;
      await owner.query("BEGIN");
      await owner.query(
        `INSERT INTO connector_call_observation
           (vendor_account_id, provisioning_action_id, correlation_id,
            operation, attempt, phase, summary, occurred_at)
         VALUES ($1, $2, $3, 'provision', 3, 'requested', '{}', $4)`,
        [ids.account, ids.action, ids.integrityCorrelation, occurredAt],
      );
      const terminal = insert({
        attempt: 3,
        phase: "succeeded",
        classification: "success",
      });
      try {
        await expect.poll(async () => (await owner.query<{ count: number }>(
          `SELECT count(*)::int AS count
             FROM pg_locks
            WHERE pid = $1 AND locktype = 'advisory' AND NOT granted`,
          [appPid],
        )).rows[0]!.count).toBe(1);
      } finally {
        await owner.query("COMMIT");
      }
      await expect(terminal).resolves.toMatchObject({
        rows: [{ attempt: 3, phase: "succeeded" }],
      });

      for (const statement of [
        "UPDATE connector_call_observation SET summary = '{}'::jsonb",
        "DELETE FROM connector_call_observation",
      ]) {
        await expect(app.query(statement)).rejects.toMatchObject({ code: "42501" });
        await expect(owner.query(statement)).rejects.toMatchObject({ code: "55000" });
      }
      await expect(app.query(
        "TRUNCATE connector_call_observation",
      )).rejects.toMatchObject({ code: "42501" });
      expect((await app.query(
        `SELECT attempt, phase
           FROM connector_call_observation
          WHERE correlation_id = $1
          ORDER BY attempt, CASE phase WHEN 'requested' THEN 0 ELSE 1 END`,
        [ids.integrityCorrelation],
      )).rows).toEqual([
        { attempt: 1, phase: "requested" },
        { attempt: 1, phase: "failed" },
        { attempt: 2, phase: "requested" },
        { attempt: 2, phase: "succeeded" },
        { attempt: 3, phase: "requested" },
        { attempt: 3, phase: "succeeded" },
      ]);
    } finally {
      await Promise.all([owner.end(), app.end()]);
    }
  }, 150_000);

  test("binds the real Anthropic transport lifecycle to committed fail-closed journal evidence", async () => {
    const { createConnectorCallObservationAppender } =
      await loadConnectorCallObservations();
    const [
      { createAnthropicConnectorObservationBridge },
      { createAnthropicRequestExecutor },
      { createAnthropicRateLimiter },
    ] =
      await Promise.all([
        import(/* @vite-ignore */ providerObservationModuleSpecifier),
        import(/* @vite-ignore */ providerRequestModuleUrl),
        import(/* @vite-ignore */ providerRateLimiterModuleUrl),
      ]);
    const fixture = await createPostgresFixture();
    fixtures.push(fixture);
    await fixture.migrate();
    await seedObservationContext(fixture);
    const journal = createConnectorCallObservationAppender(fixture.appUrl);
    const observerConnection = await fixture.connectAsOwner();
    let insertRevoked = false;

    try {
      let visibleRequestedRows = 0;
      const visibleSuccess = createJournaledAnthropicExecutor({
        append: journal.append,
        correlationId: ids.visibleCorrelation,
        createObservationBridge: createAnthropicConnectorObservationBridge,
        createRateLimiter: createAnthropicRateLimiter,
        createRequestExecutor: createAnthropicRequestExecutor,
        transport: async () => {
          visibleRequestedRows = (await observerConnection.query<{ count: number }>(
            `SELECT count(*)::int AS count
               FROM connector_call_observation
              WHERE correlation_id = $1 AND phase = 'requested'`,
            [ids.visibleCorrelation],
          )).rows[0]!.count;
          return new Response("success", { status: 200 });
        },
      });

      await expect(visibleSuccess({
        endpoint: "members",
        vendorAccountId: ids.account,
        credentials: anthropicCredentials,
      })).resolves.toMatchObject({ ok: true, attempts: 1 });
      expect(visibleRequestedRows).toBe(1);
      expect(await persistedLifecycle(observerConnection, ids.visibleCorrelation)).toEqual([
        {
          attempt: 1,
          phase: "requested",
          classification: null,
          summary: { endpoint_class: "members", method: "GET" },
        },
        {
          attempt: 1,
          phase: "succeeded",
          classification: "success",
          summary: {
            endpoint_class: "members",
            method: "GET",
            http_status: 200,
            status_class: "success",
          },
        },
      ]);

      for (const [correlationId, status, classification] of [
        [ids.clientFailureCorrelation, 400, "client_error"],
        [ids.providerFailureCorrelation, 503, "provider_error"],
      ] as const) {
        const knownFailure = createJournaledAnthropicExecutor({
          append: journal.append,
          correlationId,
          createObservationBridge: createAnthropicConnectorObservationBridge,
          createRateLimiter: createAnthropicRateLimiter,
          createRequestExecutor: createAnthropicRequestExecutor,
          operation: "provision",
          provisioningActionId: ids.action,
          transport: async () => new Response("known failure", { status }),
        });

        await expect(knownFailure({
          endpoint: "create_invite",
          vendorAccountId: ids.account,
          credentials: anthropicCredentials,
          body: { email: "provider-boundary@example.test" },
        })).resolves.toEqual({
          ok: false,
          classification,
          status,
          attempts: 1,
        });
        expect(await persistedLifecycle(observerConnection, correlationId)).toEqual([
          {
            attempt: 1,
            phase: "requested",
            classification: null,
            summary: { endpoint_class: "invitations", method: "POST" },
          },
          {
            attempt: 1,
            phase: "failed",
            classification,
            summary: {
              endpoint_class: "invitations",
              method: "POST",
              http_status: status,
              status_class: classification,
            },
          },
        ]);
      }

      const retryStatuses = [503, 200];
      const retry = createJournaledAnthropicExecutor({
        append: journal.append,
        correlationId: ids.retryCorrelation,
        createObservationBridge: createAnthropicConnectorObservationBridge,
        createRateLimiter: createAnthropicRateLimiter,
        createRequestExecutor: createAnthropicRequestExecutor,
        transport: async () => new Response("retry", {
          status: retryStatuses.shift()!,
        }),
      });

      await expect(retry({
        endpoint: "members",
        vendorAccountId: ids.account,
        credentials: anthropicCredentials,
      })).resolves.toMatchObject({ ok: true, attempts: 2 });
      expect(await persistedLifecycle(observerConnection, ids.retryCorrelation)).toEqual([
        {
          attempt: 1,
          phase: "requested",
          classification: null,
          summary: { endpoint_class: "members", method: "GET" },
        },
        {
          attempt: 1,
          phase: "failed",
          classification: "provider_error",
          summary: {
            endpoint_class: "members",
            method: "GET",
            http_status: 503,
            status_class: "provider_error",
          },
        },
        {
          attempt: 2,
          phase: "requested",
          classification: null,
          summary: { endpoint_class: "members", method: "GET" },
        },
        {
          attempt: 2,
          phase: "succeeded",
          classification: "success",
          summary: {
            endpoint_class: "members",
            method: "GET",
            http_status: 200,
            status_class: "success",
          },
        },
      ]);

      const ambiguous = createJournaledAnthropicExecutor({
        append: journal.append,
        correlationId: ids.ambiguousCorrelation,
        createObservationBridge: createAnthropicConnectorObservationBridge,
        createRateLimiter: createAnthropicRateLimiter,
        createRequestExecutor: createAnthropicRequestExecutor,
        transport: async () => {
          throw new Error("ambiguous provider outcome");
        },
      });

      await expect(ambiguous({
        endpoint: "members",
        vendorAccountId: ids.account,
        credentials: anthropicCredentials,
      })).resolves.toEqual({
        ok: false,
        classification: "transport_ambiguous",
        status: null,
        attempts: 1,
      });
      expect(await persistedLifecycle(observerConnection, ids.ambiguousCorrelation)).toEqual([
        {
          attempt: 1,
          phase: "requested",
          classification: null,
          summary: { endpoint_class: "members", method: "GET" },
        },
      ]);

      await observerConnection.query(
        "REVOKE INSERT ON connector_call_observation FROM ledger_app",
      );
      insertRevoked = true;
      let requestedFailureTransportCalls = 0;
      const requestedFailure = createJournaledAnthropicExecutor({
        append: journal.append,
        correlationId: ids.requestedFailureCorrelation,
        createObservationBridge: createAnthropicConnectorObservationBridge,
        createRateLimiter: createAnthropicRateLimiter,
        createRequestExecutor: createAnthropicRequestExecutor,
        transport: async () => {
          requestedFailureTransportCalls += 1;
          return new Response("must not be called", { status: 200 });
        },
      });

      await expect(requestedFailure({
        endpoint: "members",
        vendorAccountId: ids.account,
        credentials: anthropicCredentials,
      })).rejects.toMatchObject({ code: "42501" });
      expect(requestedFailureTransportCalls).toBe(0);
      expect(await persistedLifecycle(
        observerConnection,
        ids.requestedFailureCorrelation,
      )).toEqual([]);
      await observerConnection.query(
        "GRANT INSERT ON connector_call_observation TO ledger_app",
      );
      insertRevoked = false;

      let responseCancelled = false;
      const terminalFailure = createJournaledAnthropicExecutor({
        append: journal.append,
        correlationId: ids.terminalFailureCorrelation,
        createObservationBridge: createAnthropicConnectorObservationBridge,
        createRateLimiter: createAnthropicRateLimiter,
        createRequestExecutor: createAnthropicRequestExecutor,
        transport: async () => {
          await observerConnection.query(
            "REVOKE INSERT ON connector_call_observation FROM ledger_app",
          );
          insertRevoked = true;
          return new Response(new ReadableStream({
            cancel() {
              responseCancelled = true;
            },
          }), { status: 200 });
        },
      });

      await expect(terminalFailure({
        endpoint: "members",
        vendorAccountId: ids.account,
        credentials: anthropicCredentials,
      })).rejects.toMatchObject({ code: "42501" });
      expect(responseCancelled).toBe(true);
      expect(await persistedLifecycle(
        observerConnection,
        ids.terminalFailureCorrelation,
      )).toEqual([
        {
          attempt: 1,
          phase: "requested",
          classification: null,
          summary: { endpoint_class: "members", method: "GET" },
        },
      ]);
    } finally {
      if (insertRevoked) {
        await observerConnection.query(
          "GRANT INSERT ON connector_call_observation TO ledger_app",
        );
      }
      await Promise.all([
        typeof journal?.close === "function" ? journal.close() : undefined,
        observerConnection.end(),
      ]);
    }
  }, 150_000);
});
