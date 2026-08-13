import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";

import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";

import type { LedgerSessionUser } from "@/lib/auth/auth-types";
import { createDynamicBreadcrumbRepository } from "./repository";

const ids = {
  companyA: "21000000-0000-0000-0000-000000000001",
  companyB: "21000000-0000-0000-0000-000000000002",
  personA: "21000000-0000-0000-0000-000000000011",
  personB: "21000000-0000-0000-0000-000000000012",
  vendor: "21000000-0000-0000-0000-000000000021",
  vendorAccount: "21000000-0000-0000-0000-000000000022",
  licenseType: "21000000-0000-0000-0000-000000000023",
  requestA: "21000000-0000-0000-0000-000000000031",
  requestB: "21000000-0000-0000-0000-000000000032",
  statementA: "21000000-0000-0000-0000-000000000041",
  statementB: "21000000-0000-0000-0000-000000000042",
} as const;

const systemUserId = "00000000-0000-0000-0000-000000000001";
let fixture: PostgresFixture;
let owner: pg.Client;
let app: pg.Client;
let repository: ReturnType<typeof createDynamicBreadcrumbRepository>;

function user(
  roles: LedgerSessionUser["roles"],
  companyIds: readonly string[],
): LedgerSessionUser {
  return {
    id: "breadcrumb-user",
    idpSubject: "breadcrumb-subject",
    email: "breadcrumb@example.test",
    name: "Breadcrumb User",
    globalRole: roles.includes("group_admin") ? "group_admin" : null,
    companyGrants: [],
    employeeCompanyId: companyIds[0] ?? null,
    roles,
    companyIds,
    uiLanguage: null,
  };
}

beforeAll(async () => {
  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  await owner.query(
    `
      INSERT INTO company (id, name, code, type, status, created_at, created_by)
      VALUES
        ('${ids.companyA}', 'Kickoff', 'KCK', 'internal', 'active', now(), '${systemUserId}'),
        ('${ids.companyB}', 'Hidden Company', 'HID', 'internal', 'active', now(), '${systemUserId}');
      INSERT INTO person (id, email, full_name, company_id, status, created_at, created_by)
      VALUES
        ('${ids.personA}', 'maria@example.test', 'María Fernanda Ríos', '${ids.companyA}', 'active', now(), '${systemUserId}'),
        ('${ids.personB}', 'hidden@example.test', 'Hidden Person', '${ids.companyB}', 'active', now(), '${systemUserId}');
      INSERT INTO vendor (
        id, name, connector_type, provisioning_protocol, can_provision,
        can_deprovision, has_usage_data, has_cost_data, identity_matching,
        status, created_at, created_by
      ) VALUES (
        '${ids.vendor}', 'Anthropic', 'api', 'rest', true, true, true, true, 'email',
        'active', now(), '${systemUserId}'
      );
      INSERT INTO vendor_account (
        id, vendor_id, name, mode, low_pool_floor, status, created_at, created_by
      ) VALUES (
        '${ids.vendorAccount}', '${ids.vendor}', 'Claude Enterprise · Central', 'automated', 0, 'active',
        now(), '${systemUserId}'
      );
      INSERT INTO license_type (
        id, vendor_id, name, unit, status, created_at, created_by
      ) VALUES ('${ids.licenseType}', '${ids.vendor}', 'Claude Enterprise', 'seat', 'active', now(), '${systemUserId}');
      INSERT INTO license_request (
        id, request_no, person_id, company_id, vendor_account_id,
        license_type_id, state, justification, created_at, created_by
      ) VALUES
        ('${ids.requestA}', 'REQ-0142', '${ids.personA}', '${ids.companyA}', '${ids.vendorAccount}', '${ids.licenseType}', 'active', 'fixture', now(), '${systemUserId}'),
        ('${ids.requestB}', 'REQ-HIDDEN', '${ids.personB}', '${ids.companyB}', '${ids.vendorAccount}', '${ids.licenseType}', 'active', 'fixture', now(), '${systemUserId}');
      INSERT INTO statement (
        id, company_id, period, status, opening_seats, total_usd,
        generated_at, created_at
      ) VALUES
        ('${ids.statementA}', '${ids.companyA}', '2026-07', 'final', 7, 1049.30, now(), now()),
        ('${ids.statementB}', '${ids.companyB}', '2026-06', 'final', 1, 100.00, now(), now())
    `,
  );
  app = await fixture.connectAsApp();
  repository = createDynamicBreadcrumbRepository(
    drizzle(app, { schema }),
  );
}, 150_000);

afterAll(async () => {
  await app?.end();
  await owner?.end();
  await fixture?.stop();
}, 150_000);

describe("dynamic breadcrumb repository", () => {
  test.each([
    [`/companias/${ids.companyA}`, { "company name": "Kickoff" }],
    [`/personas/${ids.personA}`, { "person name": "María Fernanda Ríos" }],
    [`/solicitudes/${ids.requestA}`, { "request short id": "REQ-0142" }],
    [
      `/estados-de-cuenta/${ids.statementA}`,
      { "company code": "KCK", period: "2026-07" },
    ],
  ] as const)(
    "resolves tenant-scoped labels for %s",
    async (pathname, expected) => {
      await expect(
        repository.resolve(pathname, user(["employee"], [ids.companyA])),
      ).resolves.toEqual(expected);
    },
  );

  test.each([
    `/companias/${ids.companyB}`,
    `/personas/${ids.personB}`,
    `/solicitudes/${ids.requestB}`,
    `/estados-de-cuenta/${ids.statementB}`,
  ])("does not resolve cross-company data for %s", async (pathname) => {
    await expect(
      repository.resolve(pathname, user(["employee"], [ids.companyA])),
    ).resolves.toBeNull();
  });

  test("resolves global vendor-account labels only for group administrators", async () => {
    await expect(
      repository.resolve(
        `/organizaciones/${ids.vendorAccount}`,
        user(["employee"], [ids.companyA]),
      ),
    ).resolves.toBeNull();
    await expect(
      repository.resolve(
        `/organizaciones/${ids.vendorAccount}`,
        user(["group_admin"], [ids.companyA, ids.companyB]),
      ),
    ).resolves.toEqual({
      "vendor account name": "Claude Enterprise · Central",
    });
  });

  test.each([
    "/organizaciones/not-a-uuid",
    "/organizaciones/21000000-0000-4000-8000-999999999999",
  ])("defers missing vendor-account routes to the page-level not-found boundary for %s", async (pathname) => {
    await expect(
      repository.resolve(pathname, user(["group_admin"], [ids.companyA, ids.companyB])),
    ).resolves.toEqual({ "vendor account name": "…" });
  });
});
