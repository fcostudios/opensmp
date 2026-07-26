import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";
import type { AuthorizationContext } from "@smp/domain/identity-access";

import {
  AuditViewerAccessError,
  createAuditQueryService,
} from "./queries";
import { parseAuditFilters } from "./types";

const adminId = "00000000-0000-0000-0000-000000000821";
const employeeId = "00000000-0000-0000-0000-000000000822";
const companyA = "00000000-0000-0000-0000-000000000823";
const companyB = "00000000-0000-0000-0000-000000000824";

const adminAuthorization: AuthorizationContext = {
  userAccountId: adminId,
  idpSubject: "audit-admin",
  globalRole: "group_admin",
  employeeCompanyId: null,
  companyGrants: [],
};
const employeeAuthorization: AuthorizationContext = {
  userAccountId: employeeId,
  idpSubject: "audit-employee",
  globalRole: null,
  employeeCompanyId: companyA,
  companyGrants: [],
};

let fixture: PostgresFixture;
let owner: pg.Client;
let appPool: pg.Pool;

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  appPool = new pg.Pool({ connectionString: fixture.appUrl });
  await owner.query(
    `INSERT INTO user_account
       (id, email, idp_subject, global_role, status, created_at)
     VALUES
       ($1, 'admin.audit@corporativo.example', 'audit-admin',
        'group_admin', 'active', now()),
       ($2, 'employee.audit@corporativo.example', 'audit-employee',
        NULL, 'active', now())`,
    [adminId, employeeId],
  );
  await owner.query(
    `INSERT INTO company
       (id, name, code, type, status, budget_monthly_usd,
        statement_language, created_at, created_by)
     VALUES
       ($1, 'Company A', 'AUA', 'internal', 'active', 100, 'es', now(), $3),
       ($2, 'Company B', 'AUB', 'external', 'active', 200, 'en', now(), $3)`,
    [companyA, companyB, adminId],
  );
  await owner.query(
    `INSERT INTO audit_log
       (id, actor_user_id, action, entity_type, entity_id, company_id,
        note, before, after, occurred_at)
     SELECT
       ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       CASE WHEN n % 2 = 0 THEN $1::uuid ELSE NULL END,
       CASE WHEN n % 3 = 0 THEN 'company.updated' ELSE 'person.created' END,
       CASE WHEN n % 3 = 0 THEN 'Company' ELSE 'Person' END,
       ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       CASE WHEN n % 2 = 0 THEN $2::uuid ELSE $3::uuid END,
       CASE WHEN n = 52 THEN 'actor supplied note' ELSE NULL END,
       CASE WHEN n % 3 = 0 THEN jsonb_build_object('name', 'before-' || n) ELSE NULL END,
       jsonb_build_object('name', 'after-' || n),
       '2026-07-25T12:00:00Z'::timestamptz + (n || ' minutes')::interval
     FROM generate_series(1, 52) AS n`,
    [adminId, companyA, companyB],
  );
  await owner.query(
    `INSERT INTO audit_log
       (id, actor_user_id, action, entity_type, entity_id, company_id,
        before, after, occurred_at)
     VALUES
       ('30000000-0000-0000-0000-000000000001', $1, 'authentication.legacy',
        'Authentication', '40000000-0000-0000-0000-000000000001', NULL,
        NULL, '{}', '2020-01-01T00:00:00Z'),
       ('30000000-0000-0000-0000-000000000002', $1, 'authorization.legacy',
        'Authorization', '40000000-0000-0000-0000-000000000002', $2,
        NULL, '{}', '2020-01-01T00:01:00Z'),
       ('30000000-0000-0000-0000-000000000003', $1, 'account.legacy',
        'user_account', '40000000-0000-0000-0000-000000000003', $2,
        NULL, '{}', '2020-01-01T00:02:00Z'),
       ('30000000-0000-0000-0000-000000000004', $1, 'timezone.boundary',
        'Company', $2, $2, NULL, '{}', '2026-07-25T04:59:59Z'),
       ('30000000-0000-0000-0000-000000000005', $1, 'timezone.boundary',
        'Company', $2, $2, NULL, '{}', '2026-07-25T05:00:00Z'),
       ('30000000-0000-0000-0000-000000000006', $1, 'timezone.boundary',
        'Company', $2, $2, NULL, '{}', '2026-07-26T04:59:59Z'),
       ('30000000-0000-0000-0000-000000000007', $1, 'timezone.boundary',
        'Company', $2, $2, NULL, '{}', '2026-07-26T05:00:00Z')`,
    [adminId, companyA],
  );
});

afterAll(async () => {
  await Promise.all([appPool.end(), owner.end()]);
  await fixture.stop();
}, 150_000);

describe("audit query service", () => {
  test("rejects malformed URL filters before they reach PostgreSQL", () => {
    expect(() =>
      parseAuditFilters({
        actor: "not-a-user-id",
        startDate: "25/07/2026",
      }),
    ).toThrow("Invalid audit filters");
  });

  test("denies a non-group-admin before reading audit rows", async () => {
    const service = createAuditQueryService(drizzle(appPool, { schema }));

    await expect(
      service.list(employeeAuthorization, {}),
    ).rejects.toEqual(new AuditViewerAccessError());
  });

  test("returns a stable 50-row cursor page with joined actor and company hints", async () => {
    const service = createAuditQueryService(drizzle(appPool, { schema }));

    await expect(service.actors(adminAuthorization)).resolves.toEqual([
      {
        id: adminId,
        email: "admin.audit@corporativo.example",
      },
    ]);
    await expect(service.entityTypes(adminAuthorization)).resolves.toEqual([
      "Authentication",
      "Authorization",
      "Company",
      "Person",
      "user_account",
    ]);
    const first = await service.list(adminAuthorization, {});
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    expect(
      first.items.find(({ note }) => note === "actor supplied note"),
    ).toMatchObject({
      actorEmail: "admin.audit@corporativo.example",
      companyCode: "AUA",
      companyName: "Company A",
      note: "actor supplied note",
    });
    const second = await service.list(adminAuthorization, {
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items).toHaveLength(9);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.items, ...second.items].map(({ id }) => id)).size,
    ).toBe(59);
  });

  test("interprets inclusive calendar-day bounds in America/Guayaquil", async () => {
    const service = createAuditQueryService(drizzle(appPool, { schema }));

    const result = await service.list(adminAuthorization, {
      action: "timezone.boundary",
      startDate: "2026-07-25",
      endDate: "2026-07-25",
    });

    expect(result.items.map(({ id }) => id)).toEqual([
      "30000000-0000-0000-0000-000000000006",
      "30000000-0000-0000-0000-000000000005",
    ]);
  });

  test("combines entity action actor and inclusive date filters exactly", async () => {
    const service = createAuditQueryService(drizzle(appPool, { schema }));

    const result = await service.list(adminAuthorization, {
      action: "company.updated",
      actor: adminId,
      entityType: "Company",
      startDate: "2026-07-25",
      endDate: "2026-07-25",
    });

    expect(result.items.length).toBeGreaterThan(0);
    expect(
      result.items.every(
        (item) =>
          item.action === "company.updated" &&
          item.actorUserId === adminId &&
          item.entityType === "Company" &&
          item.occurredAt.startsWith("2026-07-25"),
      ),
    ).toBe(true);
  });

  test("filters system actors without confusing them with missing company scope", async () => {
    const service = createAuditQueryService(drizzle(appPool, { schema }));

    const result = await service.list(adminAuthorization, {
      actor: "system",
    });

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((item) => item.actorUserId === null)).toBe(true);
    expect(result.items.every((item) => item.companyId === companyB)).toBe(true);
  });
});
