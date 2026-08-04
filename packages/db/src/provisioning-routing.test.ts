import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vitest";

import {
  ecuadorOperatingDate,
  lockCapacityPool,
  lockRequestCapacityPool,
  routeProvisioningActionInTransaction,
} from "./provisioning-routing.js";

const dialect = new PgDialect();
const ids = {
  account: "10000000-0000-4000-8000-000000000001",
  actor: "10000000-0000-4000-8000-000000000002",
  company: "10000000-0000-4000-8000-000000000003",
  license: "10000000-0000-4000-8000-000000000004",
  person: "10000000-0000-4000-8000-000000000005",
  request: "10000000-0000-4000-8000-000000000006",
};

type Query = { readonly params: unknown[]; readonly sql: string };

function scriptedExecutor(rows: readonly (readonly Record<string, unknown>[])[]) {
  const queries: Query[] = [];
  let index = 0;
  return {
    executor: {
      async execute(statement: SQL) {
        const query = dialect.sqlToQuery(statement);
        queries.push({ params: query.params, sql: query.sql });
        return { rows: rows[index++] ?? [] };
      },
    },
    queries,
  };
}

const request = {
  accountMode: "orchestration",
  canProvision: false,
  companyId: ids.company,
  licenseTypeId: ids.license,
  licenseTypeName: "Ledger Pro",
  personEmail: "person@example.com",
  personId: ids.person,
  protocol: "none",
  requestId: ids.request,
  requestState: "approved",
  vendorAccountId: ids.account,
};

describe("US-023 canonical provisioning routing primitives", () => {
  test("derives the Ecuador operating date at both sides of UTC midnight", () => {
    expect(ecuadorOperatingDate(new Date("2026-08-05T04:59:59.999Z"))).toBe("2026-08-04");
    expect(ecuadorOperatingDate(new Date("2026-08-05T05:00:00.000Z"))).toBe("2026-08-05");
  });

  test("locks one account-license pool with one collision-resistant advisory key", async () => {
    const { executor, queries } = scriptedExecutor([[]]);

    await lockCapacityPool(executor as never, ids.account, ids.license);

    expect(queries).toEqual([{
      params: [`capacity-pool:${ids.account}:${ids.license}`],
      sql: "SELECT pg_advisory_xact_lock(hashtextextended(\n          $1,0))",
    }]);
  });

  test.each([
    { companyIds: "all" as const, scope: "TRUE", params: [ids.request] },
    { companyIds: [] as const, scope: "FALSE", params: [ids.request] },
    { companyIds: [ids.company] as const, scope: "company_id IN ($2::uuid)", params: [ids.request, ids.company] },
  ])("locates and locks the request pool for $scope", async ({ companyIds, params, scope }) => {
    const { executor, queries } = scriptedExecutor([[
      { licenseTypeId: ids.license, vendorAccountId: ids.account },
    ], []]);

    await expect(lockRequestCapacityPool(executor as never, ids.request, companyIds)).resolves.toEqual({
      licenseTypeId: ids.license,
      vendorAccountId: ids.account,
    });

    expect(queries[0]).toEqual({
      params,
      sql: `SELECT vendor_account_id::text AS "vendorAccountId",\n               license_type_id::text AS "licenseTypeId"\n        FROM license_request WHERE id=$1::uuid AND ${scope}`,
    });
    expect(queries[1]?.params).toEqual([`capacity-pool:${ids.account}:${ids.license}`]);
  });

  test("preserves the caller's non-leaking missing-request error and does not lock", async () => {
    const { executor, queries } = scriptedExecutor([[]]);

    await expect(
      lockRequestCapacityPool(executor as never, ids.request, "all", "REQUEST_HIDDEN"),
    ).rejects.toThrow("REQUEST_HIDDEN");
    expect(queries).toHaveLength(1);

    const defaultError = scriptedExecutor([[]]);
    await expect(
      lockRequestCapacityPool(defaultError.executor as never, ids.request, "all"),
    ).rejects.toThrow("PROVISIONING_REQUEST_NOT_FOUND");
  });

  test("renders every granted company as a distinct UUID in the request scope", async () => {
    const secondCompany = "10000000-0000-4000-8000-000000000007";
    const { executor, queries } = scriptedExecutor([[
      { licenseTypeId: ids.license, vendorAccountId: ids.account },
    ], []]);

    await lockRequestCapacityPool(executor as never, ids.request, [ids.company, secondCompany]);

    expect(queries[0]).toEqual({
      params: [ids.request, ids.company, secondCompany],
      sql: "SELECT vendor_account_id::text AS \"vendorAccountId\",\n               license_type_id::text AS \"licenseTypeId\"\n        FROM license_request WHERE id=$1::uuid AND company_id IN ($2::uuid,$3::uuid)",
    });
  });

  test("returns the canonical existing provision action without creating another", async () => {
    const existing = {
      id: ids.actor,
      kind: "checklist",
      mode: "orchestration",
      rawRequest: { operation: "provision" },
      status: "pending",
    };
    const { executor, queries } = scriptedExecutor([[request], [existing]]);

    await expect(routeProvisioningActionInTransaction(executor as never, {
      actorUserId: ids.actor,
      expectedState: "approved",
      note: "ignored",
      occurredAt: new Date("2026-08-04T15:00:00.000Z"),
      requestId: ids.request,
    })).resolves.toEqual(existing);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toEqual({
      params: [ids.request],
      sql: "SELECT request.id::text AS \"requestId\",request.state::text AS \"requestState\",\n               request.company_id::text AS \"companyId\",request.person_id::text AS \"personId\",\n               request.vendor_account_id::text AS \"vendorAccountId\",\n               request.license_type_id::text AS \"licenseTypeId\",holder.email AS \"personEmail\",\n               license.name AS \"licenseTypeName\",account.mode::text AS \"accountMode\",\n               vendor.provisioning_protocol::text AS protocol,vendor.can_provision AS \"canProvision\"\n        FROM license_request request\n        JOIN person holder ON holder.id=request.person_id AND holder.company_id=request.company_id\n        JOIN vendor_account account ON account.id=request.vendor_account_id AND account.status='active'\n        JOIN vendor ON vendor.id=account.vendor_id\n        JOIN license_type license ON license.id=request.license_type_id\n          AND license.vendor_id=vendor.id AND license.status='active'\n        WHERE request.id=$1::uuid FOR UPDATE OF request",
    });
    expect(queries[1]?.sql).toContain("raw_request->>'operation'='provision'");
    expect(queries[1]?.sql).toContain("ORDER BY created_at,id FOR UPDATE");
  });

  test("rejects absent and stale requests before planning or writing", async () => {
    const absent = scriptedExecutor([[]]);
    await expect(routeProvisioningActionInTransaction(absent.executor as never, {
      actorUserId: ids.actor,
      expectedState: "approved",
      note: "ignored",
      occurredAt: new Date("2026-08-04T15:00:00.000Z"),
      requestId: ids.request,
    })).rejects.toThrow("PROVISIONING_REQUEST_NOT_FOUND");
    expect(absent.queries).toHaveLength(1);

    const stale = scriptedExecutor([[{ ...request, requestState: "pending" }], []]);
    await expect(routeProvisioningActionInTransaction(stale.executor as never, {
      actorUserId: ids.actor,
      expectedState: "approved",
      note: "ignored",
      occurredAt: new Date("2026-08-04T15:00:00.000Z"),
      requestId: ids.request,
    })).rejects.toThrow("PROVISIONING_REQUEST_STATE_CONFLICT:pending");
    expect(stale.queries).toHaveLength(2);
  });

  test("writes one complete checklist transition with exact tenant and audit evidence", async () => {
    const occurredAt = new Date("2026-08-04T15:00:00.000Z");
    const { executor, queries } = scriptedExecutor([[request], [], [], [{ id: ids.request }], [], [], []]);

    const action = await routeProvisioningActionInTransaction(executor as never, {
      actorUserId: ids.actor,
      expectedState: "approved",
      note: "ignored",
      occurredAt,
      requestId: ids.request,
    });

    expect(action).toMatchObject({
      kind: "checklist",
      mode: "orchestration",
      status: "pending",
    });
    expect(action.rawRequest).toMatchObject({
      context: { companyId: ids.company, requestId: ids.request },
      instruction: {
        licenseTypeName: "Ledger Pro",
        personEmail: "person@example.com",
        requestId: ids.request,
        vendorAccountId: ids.account,
      },
      operation: "provision",
      protocol: "none",
      version: 1,
    });
    expect(queries).toHaveLength(7);
    expect(queries.slice(2).map(({ sql }) => sql.trim().split(/\s+/).slice(0, 3).join(" "))).toEqual([
      "INSERT INTO provisioning_action",
      "UPDATE license_request SET",
      "INSERT INTO request_transition",
      "INSERT INTO audit_log",
      "INSERT INTO audit_log",
    ]);
    expect(queries[2]?.params).toEqual([
      action.id,
      ids.request,
      ids.account,
      "checklist",
      "orchestration",
      JSON.stringify(action.rawRequest),
      occurredAt,
    ]);
    expect(queries[3]?.params).toEqual([occurredAt, ids.request, ids.company, "approved"]);
    expect(queries[4]?.params).toEqual([
      ids.request,
      "approved",
      ids.actor,
      "Orchestration checklist issued",
      occurredAt,
    ]);
    expect(queries[5]?.params).toEqual([
      ids.actor,
      ids.request,
      ids.company,
      "Orchestration checklist issued",
      JSON.stringify({ state: "approved" }),
      occurredAt,
    ]);
    expect(queries[6]?.params).toEqual([
      ids.actor,
      "orchestration.checklist_issued",
      action.id,
      ids.company,
      JSON.stringify({
        kind: "checklist",
        mode: "orchestration",
        requestId: ids.request,
        status: "pending",
      }),
      occurredAt,
    ]);
  });

  test("fails closed when the state update loses its race and emits no transition or audit", async () => {
    const { executor, queries } = scriptedExecutor([[request], [], [], []]);

    await expect(routeProvisioningActionInTransaction(executor as never, {
      actorUserId: null,
      expectedState: "approved",
      note: "ignored",
      occurredAt: new Date("2026-08-04T15:00:00.000Z"),
      requestId: ids.request,
    })).rejects.toThrow("PROVISIONING_REQUEST_UPDATE_CONFLICT");
    expect(queries).toHaveLength(4);
  });

  test("uses the trusted recovery note when resuming a blocked request", async () => {
    const occurredAt = new Date("2026-08-04T15:00:00.000Z");
    const blockedRequest = { ...request, requestState: "blocked_no_seat" };
    const { executor, queries } = scriptedExecutor([[blockedRequest], [], [], [{ id: ids.request }], [], [], []]);

    await routeProvisioningActionInTransaction(executor as never, {
      actorUserId: null,
      expectedState: "blocked_no_seat",
      note: "Capacity recovered from seat release",
      occurredAt,
      requestId: ids.request,
    });

    expect(queries[4]?.params).toEqual([
      ids.request,
      "blocked_no_seat",
      null,
      "Capacity recovered from seat release",
      occurredAt,
    ]);
    expect(queries[5]?.params).toEqual([
      null,
      ids.request,
      ids.company,
      "Capacity recovered from seat release",
      JSON.stringify({ state: "blocked_no_seat" }),
      occurredAt,
    ]);
  });
});
