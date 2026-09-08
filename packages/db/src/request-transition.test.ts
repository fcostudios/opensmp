import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vitest";

import { applyRequestTransitionInTransaction } from "./request-transition.js";

const dialect = new PgDialect();
const ids = {
  actor: "10000000-0000-4000-8000-000000000001",
  company: "10000000-0000-4000-8000-000000000002",
  request: "10000000-0000-4000-8000-000000000003",
};
const occurredAt = new Date("2026-09-07T20:00:00.000Z");

type Query = { readonly params: unknown[]; readonly sql: string };

function scriptedExecutor(rows: readonly (readonly Record<string, unknown>[])[]) {
  const queries: Query[] = [];
  let index = 0;
  return {
    executor: {
      async execute(statement: SQL) {
        const query = dialect.sqlToQuery(statement);
        queries.push({
          params: query.params,
          sql: query.sql.trim().replace(/\s+/g, " "),
        });
        return { rows: rows[index++] ?? [] };
      },
    },
    queries,
  };
}

describe("shared request transition transaction", () => {
  test("locks the exact tenant and writes a complete approval transition and audit", async () => {
    const { executor, queries } = scriptedExecutor([
      [{ companyId: ids.company, state: "pending_approval" }],
      [{ id: ids.request }],
      [],
      [],
    ]);

    await expect(applyRequestTransitionInTransaction(executor as never, {
      actorUserId: ids.actor,
      from: "pending_approval",
      note: "Budget owner approved",
      occurredAt,
      requestId: ids.request,
      to: "approved",
    }, { expectedCompanyId: ids.company })).resolves.toEqual({
      companyId: ids.company,
      state: "pending_approval",
    });

    expect(queries).toEqual([
      {
        params: [ids.request, ids.company],
        sql: 'SELECT company_id::text AS "companyId", state::text AS state FROM license_request WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE',
      },
      {
        params: ["approved", ids.actor, occurredAt, "Budget owner approved", occurredAt, ids.request, ids.company, "pending_approval"],
        sql: 'UPDATE license_request SET state = $1::license_request_state_enum, decided_by = $2::uuid, decided_at = $3, decision_comment = $4, updated_at = $5 WHERE id = $6::uuid AND company_id = $7::uuid AND state = $8::license_request_state_enum RETURNING id::text AS id',
      },
      {
        params: [ids.request, "pending_approval", "approved", ids.actor, "Budget owner approved", occurredAt],
        sql: "INSERT INTO request_transition (request_id, from_state, to_state, actor_user_id, note, occurred_at) VALUES ($1::uuid, $2, $3, $4::uuid, $5, $6)",
      },
      {
        params: [ids.actor, "request.approved", ids.request, ids.company, "Budget owner approved", JSON.stringify({ state: "pending_approval" }), JSON.stringify({ state: "approved" }), occurredAt],
        sql: "INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, company_id, note, before, after, occurred_at) VALUES ($1::uuid, $2, 'LicenseRequest', $3::uuid, $4::uuid, $5, $6::jsonb, $7::jsonb, $8)",
      },
    ]);
  });

  test("uses the non-decision update shape while preserving null machine evidence", async () => {
    const { executor, queries } = scriptedExecutor([
      [{ companyId: ids.company, state: "provisioning" }],
      [{ id: ids.request }],
      [],
      [],
    ]);

    await applyRequestTransitionInTransaction(executor as never, {
      actorUserId: null,
      from: "provisioning",
      note: null,
      occurredAt,
      requestId: ids.request,
      to: "active",
    }, { expectedCompanyId: ids.company });

    expect(queries[1]).toEqual({
      params: ["active", occurredAt, ids.request, ids.company, "provisioning"],
      sql: 'UPDATE license_request SET state = $1::license_request_state_enum, updated_at = $2 WHERE id = $3::uuid AND company_id = $4::uuid AND state = $5::license_request_state_enum RETURNING id::text AS id',
    });
    expect(queries[2]?.params).toEqual([
      ids.request,
      "provisioning",
      "active",
      null,
      null,
      occurredAt,
    ]);
    expect(queries[3]?.params).toEqual([
      null,
      "request.active",
      ids.request,
      ids.company,
      null,
      JSON.stringify({ state: "provisioning" }),
      JSON.stringify({ state: "active" }),
      occurredAt,
    ]);
  });

  test.each([
    {
      expectedDecisionColumns: true,
      from: "pending_approval" as const,
      to: "rejected" as const,
    },
    {
      expectedDecisionColumns: false,
      from: "provisioning" as const,
      to: "approved" as const,
    },
  ])("selects the decision update only for a pending approval to $to", async ({
    expectedDecisionColumns,
    from,
    to,
  }) => {
    const { executor, queries } = scriptedExecutor([
      [{ companyId: ids.company, state: from }],
      [{ id: ids.request }],
      [],
      [],
    ]);

    await applyRequestTransitionInTransaction(executor as never, {
      actorUserId: ids.actor,
      from,
      note: "decision boundary",
      occurredAt,
      requestId: ids.request,
      to,
    }, { expectedCompanyId: ids.company });

    expect(queries[1]?.sql.includes("decided_by")).toBe(expectedDecisionColumns);
  });

  test("fails before writes for a missing or stale locked request", async () => {
    const missing = scriptedExecutor([[]]);
    await expect(applyRequestTransitionInTransaction(missing.executor as never, {
      actorUserId: ids.actor,
      from: "pending_approval",
      note: null,
      occurredAt,
      requestId: ids.request,
      to: "approved",
    }, { expectedCompanyId: ids.company })).rejects.toThrow(`REQUEST_NOT_FOUND:${ids.request}`);
    expect(missing.queries).toHaveLength(1);

    const stale = scriptedExecutor([[{ companyId: ids.company, state: "approved" }]]);
    await expect(applyRequestTransitionInTransaction(stale.executor as never, {
      actorUserId: ids.actor,
      from: "pending_approval",
      note: null,
      occurredAt,
      requestId: ids.request,
      to: "rejected",
    }, { expectedCompanyId: ids.company })).rejects.toThrow(
      `REQUEST_STATE_CONFLICT:${ids.request}:pending_approval:approved`,
    );
    expect(stale.queries).toHaveLength(1);
  });

  test("fails before evidence when the locked state loses its update race", async () => {
    const { executor, queries } = scriptedExecutor([
      [{ companyId: ids.company, state: "pending_approval" }],
      [],
    ]);

    await expect(applyRequestTransitionInTransaction(executor as never, {
      actorUserId: ids.actor,
      from: "pending_approval",
      note: null,
      occurredAt,
      requestId: ids.request,
      to: "approved",
    }, { expectedCompanyId: ids.company })).rejects.toThrow(
      `REQUEST_UPDATE_CONFLICT:${ids.request}`,
    );
    expect(queries).toHaveLength(2);
  });
});
