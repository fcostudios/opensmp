import { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  alertEvent,
  alert_rule_type_enum,
  auditLog,
  licenseRequest,
  person,
  vendorAccount,
  vendorAccountCapacity,
} from "./schema";
import {
  createPostgresFixture,
  type PostgresFixture,
} from "./testing/postgres-container";

const FIXTURE = {
  userId: "00000000-0000-4000-8000-000000000001",
  companyAId: "00000000-0000-4000-8000-000000000010",
  companyBId: "00000000-0000-4000-8000-000000000011",
  personAId: "00000000-0000-4000-8000-000000000020",
  personBId: "00000000-0000-4000-8000-000000000021",
  vendorId: "00000000-0000-4000-8000-000000000030",
  vendorAccountId: "00000000-0000-4000-8000-000000000031",
  licenseTypeId: "00000000-0000-4000-8000-000000000032",
  alertRuleId: "00000000-0000-4000-8000-000000000040",
  occurredAt: "2026-07-27T09:00:00.000Z",
} as const;

let database: PostgresFixture;
let client: pg.Client;

async function expectUniqueViolation(
  query: Promise<unknown>,
  constraint: string,
): Promise<void> {
  await expect(query).rejects.toMatchObject({ code: "23505", constraint });
}

function renderSql(fragment: SQL | undefined): string | undefined {
  return fragment
    ? new PgDialect().sqlToQuery(fragment).sql.replaceAll('"', "")
    : undefined;
}

beforeAll(async () => {
  database = await createPostgresFixture();
  await database.migrate();
  client = await database.connectAsApp();

  await client.query(
    `
      INSERT INTO user_account (id, email, status, created_at)
      VALUES ($1, 'schema-owner@example.test', 'active', $2)
    `,
    [FIXTURE.userId, FIXTURE.occurredAt],
  );
  await client.query(
    `
      INSERT INTO company (id, name, code, type, status, created_at, created_by)
      VALUES
        ($1, 'Schema Company A', 'SCHEMA-A', 'internal', 'active', $3, $4),
        ($2, 'Schema Company B', 'SCHEMA-B', 'external', 'active', $3, $4)
    `,
    [
      FIXTURE.companyAId,
      FIXTURE.companyBId,
      FIXTURE.occurredAt,
      FIXTURE.userId,
    ],
  );
  await client.query(
    `
      INSERT INTO person (id, email, full_name, company_id, status, created_at, created_by)
      VALUES
        ($1, 'baseline-a@example.test', 'Baseline A', $3, 'active', $5, $6),
        ($2, 'baseline-b@example.test', 'Baseline B', $4, 'active', $5, $6)
    `,
    [
      FIXTURE.personAId,
      FIXTURE.personBId,
      FIXTURE.companyAId,
      FIXTURE.companyBId,
      FIXTURE.occurredAt,
      FIXTURE.userId,
    ],
  );
  await client.query(
    `
      INSERT INTO vendor (
        id,
        name,
        connector_type,
        provisioning_protocol,
        can_provision,
        can_deprovision,
        has_usage_data,
        has_cost_data,
        identity_matching,
        status,
        created_at,
        created_by
      )
      VALUES ($1, 'Schema Vendor', 'manual', 'none', false, false, false, false, 'email', 'active', $2, $3)
    `,
    [FIXTURE.vendorId, FIXTURE.occurredAt, FIXTURE.userId],
  );
  await client.query(
    `
      INSERT INTO vendor_account (
        id,
        vendor_id,
        name,
        mode,
        low_pool_floor,
        status,
        created_at,
        created_by
      )
      VALUES ($1, $2, 'Schema Vendor Account', 'orchestration', 0, 'active', $3, $4)
    `,
    [
      FIXTURE.vendorAccountId,
      FIXTURE.vendorId,
      FIXTURE.occurredAt,
      FIXTURE.userId,
    ],
  );
  await client.query(
    `
      INSERT INTO license_type (id, vendor_id, name, unit, status, created_at, created_by)
      VALUES ($1, $2, 'Schema License', 'seat', 'active', $3, $4)
    `,
    [
      FIXTURE.licenseTypeId,
      FIXTURE.vendorId,
      FIXTURE.occurredAt,
      FIXTURE.userId,
    ],
  );
  await client.query(
    `
      INSERT INTO alert_rule (
        id,
        type,
        scope_kind,
        vendor_account_id,
        channel,
        enabled,
        created_at,
        created_by
      )
      VALUES ($1, 'approval_aging', 'vendor_account', $2, 'email', true, $3, $4)
    `,
    [
      FIXTURE.alertRuleId,
      FIXTURE.vendorAccountId,
      FIXTURE.occurredAt,
      FIXTURE.userId,
    ],
  );
}, 180_000);

afterAll(async () => {
  await client?.end();
  await database?.stop();
}, 60_000);

describe("Sprint 2 workflow database guards", () => {
  test("adds the workflow alert rule values to the committed database enum", async () => {
    const enumResult = await client.query<{ enumlabel: string }>(
      `
        SELECT enum_value.enumlabel
        FROM pg_enum AS enum_value
        JOIN pg_type AS enum_type ON enum_type.oid = enum_value.enumtypid
        WHERE enum_type.typname = 'alert_rule_type_enum'
      `,
    );
    const databaseEnumValues = enumResult.rows.map(({ enumlabel }) => enumlabel);

    expect(databaseEnumValues).toEqual(
      expect.arrayContaining(["deprovision_overdue", "close_missed"]),
    );
  });

  test("exposes the workflow alert rule values through Drizzle metadata", () => {
    expect(alert_rule_type_enum.enumValues).toEqual(
      expect.arrayContaining(["deprovision_overdue", "close_missed"]),
    );
  });

  test("keeps the workflow guard indexes and columns in Drizzle metadata", () => {
    const personConfig = getTableConfig(person);
    const alertEventConfig = getTableConfig(alertEvent);
    const auditLogConfig = getTableConfig(auditLog);
    const requestConfig = getTableConfig(licenseRequest);
    const vendorAccountConfig = getTableConfig(vendorAccount);
    const capacityConfig = getTableConfig(vendorAccountCapacity);
    const personEmailIndex = personConfig.indexes.find(
      ({ config }) => config.name === "uq_person_lower_email",
    );
    const alertDedupeIndex = alertEventConfig.indexes.find(
      ({ config }) => config.name === "uq_alert_event_dedupe_key",
    );
    const requestNumberColumn = requestConfig.columns.find(
      ({ name }) => name === "request_no",
    );
    const clientRequestColumn = requestConfig.columns.find(
      ({ name }) => name === "client_request_id",
    );
    const requestIdempotencyConstraint = requestConfig.uniqueConstraints.find(
      ({ name }) => name === "uq_license_request_requester_client_request",
    );
    const crossOrgMoveIndex = auditLogConfig.indexes.find(
      ({ config }) => config.name === "uq_cross_org_move_client_request",
    );

    expect(personEmailIndex?.config.unique).toBe(true);
    expect(
      renderSql(personEmailIndex?.config.columns[0] as SQL | undefined),
    ).toBe("lower(person.email)");
    expect(alertEventConfig.columns.map(({ name }) => name)).toContain(
      "dedupe_key",
    );
    expect(alertDedupeIndex?.config.unique).toBe(true);
    expect(
      (alertDedupeIndex?.config.columns[0] as { name?: string } | undefined)
        ?.name,
    ).toBe("dedupe_key");
    expect(renderSql(alertDedupeIndex?.config.where)).toBe(
      "alert_event.dedupe_key IS NOT NULL",
    );
    expect(requestNumberColumn?.isUnique).toBe(true);
    expect(requestNumberColumn?.uniqueName).toBe(
      "uq_license_request_request_no",
    );
    expect(clientRequestColumn?.notNull).toBe(true);
    expect(clientRequestColumn?.hasDefault).toBe(true);
    expect(
      requestIdempotencyConstraint?.columns.map(({ name }) => name),
    ).toEqual(["requested_by", "client_request_id"]);
    expect(crossOrgMoveIndex?.config.unique).toBe(true);
    expect(renderSql(crossOrgMoveIndex?.config.where)).toBe(
      "audit_log.entity_type = 'CrossOrgMove' AND audit_log.after->>'clientRequestId' IS NOT NULL",
    );
    expect(
      vendorAccountConfig.checks.map(({ name, value }) => ({
        name,
        sql: renderSql(value),
      })),
    ).toContainEqual({
      name: "vendor_account_low_pool_floor_nonnegative",
      sql: "vendor_account.low_pool_floor >= 0",
    });
    expect(
      capacityConfig.checks.map(({ name, value }) => ({
        name,
        sql: renderSql(value),
      })),
    ).toContainEqual({
      name: "vendor_account_capacity_purchased_qty_nonnegative",
      sql: "vendor_account_capacity.purchased_qty >= 0",
    });
  });

  test("enforces request idempotency per requester across company boundaries", async () => {
    const clientRequestId = "00000000-0000-4000-8000-000000000060";
    const secondUserId = "00000000-0000-4000-8000-000000000002";
    await client.query("BEGIN");
    try {
      await client.query(
        `
          INSERT INTO user_account (id, email, status, created_at)
          VALUES ($1, 'second-schema-owner@example.test', 'active', $2)
        `,
        [secondUserId, FIXTURE.occurredAt],
      );
      await client.query(
        `
          INSERT INTO license_request (
            id, request_no, person_id, company_id, vendor_account_id,
            license_type_id, state, justification, requested_by,
            client_request_id, created_at, created_by
          )
          VALUES (
            '00000000-0000-4000-8000-000000000061',
            'SCHEMA-IDEMPOTENCY-1', $1, $2, $3, $4, 'submitted',
            'idempotency baseline', $5, $6, $7, $5
          )
        `,
        [
          FIXTURE.personAId,
          FIXTURE.companyAId,
          FIXTURE.vendorAccountId,
          FIXTURE.licenseTypeId,
          FIXTURE.userId,
          clientRequestId,
          FIXTURE.occurredAt,
        ],
      );

      await client.query("SAVEPOINT duplicate_request");
      await expectUniqueViolation(
        client.query(
          `
            INSERT INTO license_request (
              id, request_no, person_id, company_id, vendor_account_id,
              license_type_id, state, justification, requested_by,
              client_request_id, created_at, created_by
            )
            VALUES (
              '00000000-0000-4000-8000-000000000062',
              'SCHEMA-IDEMPOTENCY-2', $1, $2, $3, $4, 'submitted',
              'cross-company duplicate', $5, $6, $7, $5
            )
          `,
          [
            FIXTURE.personBId,
            FIXTURE.companyBId,
            FIXTURE.vendorAccountId,
            FIXTURE.licenseTypeId,
            FIXTURE.userId,
            clientRequestId,
            FIXTURE.occurredAt,
          ],
        ),
        "uq_license_request_requester_client_request",
      );
      await client.query("ROLLBACK TO SAVEPOINT duplicate_request");

      const otherRequester = await client.query(
        `
          INSERT INTO license_request (
            id, request_no, person_id, company_id, vendor_account_id,
            license_type_id, state, justification, requested_by,
            client_request_id, created_at, created_by
          )
          VALUES (
            '00000000-0000-4000-8000-000000000063',
            'SCHEMA-IDEMPOTENCY-3', $1, $2, $3, $4, 'submitted',
            'different requester', $5, $6, $7, $5
          )
          RETURNING id::text
        `,
        [
          FIXTURE.personBId,
          FIXTURE.companyBId,
          FIXTURE.vendorAccountId,
          FIXTURE.licenseTypeId,
          secondUserId,
          clientRequestId,
          FIXTURE.occurredAt,
        ],
      );
      expect(otherRequester.rows).toEqual([
        { id: "00000000-0000-4000-8000-000000000063" },
      ]);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  test("rejects person emails that differ only by case across companies", async () => {
    await client.query(
      `
        INSERT INTO person (id, email, full_name, company_id, status, created_at, created_by)
        VALUES (
          '00000000-0000-4000-8000-000000000022',
          'USER@example.com',
          'Uppercase User',
          $1,
          'active',
          $2,
          $3
        )
      `,
      [FIXTURE.companyAId, FIXTURE.occurredAt, FIXTURE.userId],
    );

    await expectUniqueViolation(
      client.query(
        `
          INSERT INTO person (id, email, full_name, company_id, status, created_at, created_by)
          VALUES (
            '00000000-0000-4000-8000-000000000023',
            'user@example.com',
            'Lowercase User',
            $1,
            'active',
            $2,
            $3
          )
        `,
        [FIXTURE.companyBId, FIXTURE.occurredAt, FIXTURE.userId],
      ),
      "uq_person_lower_email",
    );

    const companyAResult = await client.query<{ email: string }>(
      "SELECT email FROM person WHERE company_id = $1 ORDER BY email",
      [FIXTURE.companyAId],
    );
    const companyBResult = await client.query<{ email: string }>(
      "SELECT email FROM person WHERE company_id = $1 ORDER BY email",
      [FIXTURE.companyBId],
    );
    expect(companyAResult.rows).toEqual([
      { email: "USER@example.com" },
      { email: "baseline-a@example.test" },
    ]);
    expect(companyBResult.rows).toEqual([
      { email: "baseline-b@example.test" },
    ]);
  });

  test("rejects duplicate license request numbers", async () => {
    const insertRequest = (
      id: string,
      personId: string,
      companyId: string,
    ) =>
      client.query(
        `
          INSERT INTO license_request (
            id,
            request_no,
            person_id,
            company_id,
            vendor_account_id,
            license_type_id,
            state,
            justification,
            created_at,
            created_by
          )
          VALUES ($1, 'SOL-0001', $2, $3, $4, $5, 'submitted', 'Schema guard', $6, $7)
        `,
        [
          id,
          personId,
          companyId,
          FIXTURE.vendorAccountId,
          FIXTURE.licenseTypeId,
          FIXTURE.occurredAt,
          FIXTURE.userId,
        ],
      );

    await insertRequest(
      "00000000-0000-4000-8000-000000000050",
      FIXTURE.personAId,
      FIXTURE.companyAId,
    );
    await expectUniqueViolation(
      insertRequest(
        "00000000-0000-4000-8000-000000000051",
        FIXTURE.personBId,
        FIXTURE.companyBId,
      ),
      "uq_license_request_request_no",
    );

    const companyAResult = await client.query<{ request_no: string }>(
      "SELECT request_no FROM license_request WHERE company_id = $1",
      [FIXTURE.companyAId],
    );
    const companyBResult = await client.query<{ request_no: string }>(
      "SELECT request_no FROM license_request WHERE company_id = $1",
      [FIXTURE.companyBId],
    );
    expect(companyAResult.rows).toEqual([{ request_no: "SOL-0001" }]);
    expect(companyBResult.rows).toEqual([]);
  });

  test("allows absent alert dedupe keys and rejects duplicate non-null keys", async () => {
    const insertAlertEvent = (id: string, dedupeKey: string | null) =>
      client.query(
        `
          INSERT INTO alert_event (
            id,
            alert_rule_id,
            fired_at,
            notified,
            dedupe_key
          )
          VALUES ($1, $2, $3, '{}'::jsonb, $4)
        `,
        [id, FIXTURE.alertRuleId, FIXTURE.occurredAt, dedupeKey],
      );

    await insertAlertEvent(
      "00000000-0000-4000-8000-000000000060",
      null,
    );
    await insertAlertEvent(
      "00000000-0000-4000-8000-000000000061",
      null,
    );
    await insertAlertEvent(
      "00000000-0000-4000-8000-000000000062",
      "workflow:request:SOL-0001",
    );
    await expectUniqueViolation(
      insertAlertEvent(
        "00000000-0000-4000-8000-000000000063",
        "workflow:request:SOL-0001",
      ),
      "uq_alert_event_dedupe_key",
    );

    const result = await client.query<{ dedupe_key: string | null }>(
      "SELECT dedupe_key FROM alert_event ORDER BY id",
    );
    expect(result.rows).toEqual([
      { dedupe_key: null },
      { dedupe_key: null },
      { dedupe_key: "workflow:request:SOL-0001" },
    ]);
  });
});
