import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
  parseRegisterFilters,
  serializeRegisterFilters,
} from "@smp/contracts/register";
import {
  createPostgresFixture,
  type PostgresFixture,
} from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";

import {
  createAuthorizationRepository,
  type LedgerAuthorization,
} from "../identity-access/authorization";
import { createRegisterCsvDownload } from "./actions";
import { createRegisterExportResponse } from "./export-boundary";
import {
  createRegisterRepository,
} from "./repository";

const actorId = "00000000-0000-4000-8000-000000003301";
const companyA = "00000000-0000-4000-8000-000000003302";
const companyB = "00000000-0000-4000-8000-000000003303";
const vendorId = "00000000-0000-4000-8000-000000003304";
const vendorAccountA = "00000000-0000-4000-8000-000000003305";
const vendorAccountB = "00000000-0000-4000-8000-000000003306";
const licenseTypeA = "00000000-0000-4000-8000-000000003307";
const licenseTypeB = "00000000-0000-4000-8000-000000003308";
const personA1 = "00000000-0000-4000-8000-000000003309";
const personA2 = "00000000-0000-4000-8000-000000003310";
const personA3 = "00000000-0000-4000-8000-000000003311";
const personB = "00000000-0000-4000-8000-000000003312";
const requestA = "00000000-0000-4000-8000-000000003313";
const requestB = "00000000-0000-4000-8000-000000003314";
const assignmentA1 = "00000000-0000-4000-8000-000000003315";
const assignmentA2 = "00000000-0000-4000-8000-000000003316";
const assignmentA3 = "00000000-0000-4000-8000-000000003317";
const assignmentB = "00000000-0000-4000-8000-000000003318";
const financeUserId = "00000000-0000-4000-8000-000000003323";
const viewerUserId = "00000000-0000-4000-8000-000000003324";

let fixture: PostgresFixture | undefined;
let owner: pg.Client;
let appPool: pg.Pool;
let appUrl: string;

const authForCompanyA: LedgerAuthorization = {
  userId: actorId,
  userAccountId: actorId,
  idpSubject: "register-company-a",
  globalRole: null,
  roles: ["company_finance"],
  companyIds: [companyA],
  employeeCompanyId: null,
  companyGrants: [{ companyId: companyA, role: "finance" }],
};

const authForGroupAdmin: LedgerAuthorization = {
  userId: actorId,
  userAccountId: actorId,
  idpSubject: "register-group-admin",
  globalRole: "group_admin",
  roles: ["group_admin"],
  companyIds: [companyA, companyB],
  employeeCompanyId: null,
  companyGrants: [],
};

function countCsvRecords(csv: string): number {
  let quoted = false;
  let records = 0;
  for (let index = 0; index < csv.length; index += 1) {
    if (csv[index] === '"') {
      if (quoted && csv[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    }
    if (!quoted && csv[index] === "\r" && csv[index + 1] === "\n") {
      records += 1;
      index += 1;
    }
  }
  return records;
}

async function seedRegisterFixture() {
  const occurredAt = new Date("2026-07-28T00:00:00.000Z");

  await owner.query(
    `INSERT INTO user_account (id, email, idp_subject, global_role, status, created_at)
     VALUES
       ($1, 'register.admin@example.test', 'register-admin', 'group_admin', 'active', $2),
       ($3, 'register.finance@example.test', 'register-finance-a', NULL, 'active', $2),
       ($4, 'register.viewer@example.test', 'register-viewer', NULL, 'active', $2)`,
    [actorId, occurredAt, financeUserId, viewerUserId],
  );
  await owner.query(
    `INSERT INTO company (id, name, code, type, status, created_at, created_by)
     VALUES
       ($1, 'Alpha Company', 'ALP', 'internal', 'active', $3, $4),
       ($2, 'Bravo Company', 'BRV', 'internal', 'active', $3, $4)`,
    [companyA, companyB, occurredAt, actorId],
  );
  await owner.query(
    `INSERT INTO company_role_assignment (id, user_account_id, company_id, role, unique_grant, created_at, created_by)
     VALUES
       ('00000000-0000-4000-8000-000000003325', $1, $3, 'finance', 'register-finance-a', $4, $1),
       ('00000000-0000-4000-8000-000000003326', $2, $3, 'viewer', 'register-viewer-a', $4, $1)`,
    [financeUserId, viewerUserId, companyA, occurredAt],
  );
  await owner.query(
    `INSERT INTO vendor (id, name, connector_type, provisioning_protocol, can_provision,
                         can_deprovision, has_usage_data, has_cost_data, identity_matching,
                         status, created_at, created_by)
     VALUES ($1, 'Register Vendor', 'orchestration', 'none', false, false,
             true, false, 'email', 'active', $2, $3)`,
    [vendorId, occurredAt, actorId],
  );
  await owner.query(
    `INSERT INTO vendor_account (id, vendor_id, name, mode, low_pool_floor, status, created_at, created_by)
     VALUES
       ($1, $3, 'Register Org A', 'orchestration', 1, 'active', $4, $5),
       ($2, $3, 'Register Org B', 'orchestration', 1, 'active', $4, $5)`,
    [vendorAccountA, vendorAccountB, vendorId, occurredAt, actorId],
  );
  await owner.query(
    `INSERT INTO license_type (id, vendor_id, name, unit, status, created_at, created_by)
     VALUES
       ($1, $3, 'Enterprise', 'seat', 'active', $4, $5),
       ($2, $3, 'Standard', 'seat', 'active', $4, $5)`,
    [licenseTypeA, licenseTypeB, vendorId, occurredAt, actorId],
  );
  await owner.query(
    `INSERT INTO person (id, email, full_name, company_id, status, created_at, created_by)
     VALUES
       ($1, 'alicia@example.test', 'Alicia, "Quoted"\r\nCell', $5, 'active', $6, $7),
       ($2, 'bruno@example.test', 'Bruno Import', $5, 'active', $6, $7),
       ($3, 'carla@example.test', 'Carla Reconciliation', $5, 'active', $6, $7),
       ($4, 'bravo@example.test', 'Bravo Tenant', $8, 'active', $6, $7)`,
    [personA1, personA2, personA3, personB, companyA, occurredAt, actorId, companyB],
  );
  await owner.query(
    `INSERT INTO license_request (id, request_no, person_id, company_id, vendor_account_id,
                                  license_type_id, state, justification, decided_at, created_at, created_by)
     VALUES
       ($1, 'SOL-1001', $3, $5, $7, $9, 'active', 'request A', '2026-02-02T18:30:00.000Z', $11, $12),
       ($2, 'SOL-2001', $4, $6, $8, $10, 'rejected', 'request B', '2026-02-03T18:30:00.000Z', $11, $12)`,
    [requestA, requestB, personA1, personB, companyA, companyB, vendorAccountA, vendorAccountB, licenseTypeA, licenseTypeB, occurredAt, actorId],
  );
  await owner.query(
    `INSERT INTO license_assignment (id, person_id, company_id, vendor_account_id, license_type_id,
                                     started_on, ended_on, end_reason, source_request_id, source_kind, note,
                                     created_at, created_by)
     VALUES
       ($1, $5, $9, $11, $13, '2026-01-01', NULL, NULL, $15, 'request', NULL, $17, $18),
       ($2, $6, $9, $11, $13, '2026-02-01', '2026-02-28', 'inactive', NULL, 'import', E'\\u2003=initial import', $17, $18),
       ($3, $7, $9, $11, $14, '2026-03-01', '2026-03-15', 'left_company', NULL, 'reconciliation', '+reconciled', $17, $18),
       ($4, $8, $10, $12, $14, '2026-01-01', NULL, NULL, $16, 'request', NULL, $17, $18)`,
    [assignmentA1, assignmentA2, assignmentA3, assignmentB, personA1, personA2, personA3, personB, companyA, companyB, vendorAccountA, vendorAccountB, licenseTypeA, licenseTypeB, requestA, requestB, occurredAt, actorId],
  );
  await owner.query(
    `INSERT INTO statement (id, company_id, period, status, opening_seats, total_usd, generated_at, created_at)
     VALUES
       ('00000000-0000-4000-8000-000000003319', $1, '2026-01', 'final', 1, 10.00, $3, $3),
       ('00000000-0000-4000-8000-000000003320', $2, '2026-01', 'final', 1, 10.00, $3, $3)`,
    [companyA, companyB, occurredAt],
  );
  await owner.query(
    `INSERT INTO statement_line (id, statement_id, kind, person_id, vendor_account_id, license_type_id,
                                 assignment_id, license_days, rate_usd, amount_usd, period_from, period_to, note)
     VALUES
       ('00000000-0000-4000-8000-000000003321', '00000000-0000-4000-8000-000000003319', 'license', $1, $3, $5, $7, 31, 10.00, 10.00, '2026-01-01', '2026-01-31', 'A trace'),
       ('00000000-0000-4000-8000-000000003322', '00000000-0000-4000-8000-000000003320', 'license', $2, $4, $6, $8, 31, 10.00, 10.00, '2026-01-01', '2026-01-31', 'B trace')`,
    [personA1, personB, vendorAccountA, vendorAccountB, licenseTypeA, licenseTypeB, assignmentA1, assignmentB],
  );
}

beforeAll(async () => {
  const mutationAppUrl = process.env.US033_MUTATION_DATABASE_URL;
  const mutationOwnerUrl = process.env.US033_MUTATION_DATABASE_ADMIN_URL;

  if (mutationAppUrl || mutationOwnerUrl) {
    if (!mutationAppUrl || !mutationOwnerUrl) {
      throw new Error(
        "US033 mutation harness requires both application and owner database URLs",
      );
    }
    owner = new pg.Client({ connectionString: mutationOwnerUrl });
    await owner.connect();
    appUrl = mutationAppUrl;
    appPool = new pg.Pool({ connectionString: mutationAppUrl });
    return;
  }

  fixture = await createPostgresFixture();
  await fixture.migrate();
  owner = await fixture.connectAsOwner();
  appUrl = fixture.appUrl;
  appPool = new pg.Pool({ connectionString: fixture.appUrl });
}, 150_000);

beforeEach(async () => {
  await owner.query(`
    TRUNCATE TABLE
      statement_line,
      statement,
      license_assignment,
      license_request,
      person,
      license_type,
      vendor_account,
      vendor,
      company_role_assignment,
      user_account,
      company
    RESTART IDENTITY CASCADE
  `);
  await seedRegisterFixture();
});

afterAll(async () => {
  await Promise.all([appPool.end(), owner.end()]);
  await fixture?.stop();
}, 150_000);

describe("US-033 register repository with real PostgreSQL", () => {
  test("builds a canonical register download only for the two generated register roles", () => {
    expect(createRegisterCsvDownload(
      authForGroupAdmin,
      { companyId: companyA, sourceRequestNo: "SOL-1001" },
    )).toEqual({
      downloadUrl: `/api/exports/register?companyId=${companyA}&sourceRequestNo=SOL-1001`,
    });
    expect(createRegisterCsvDownload(
      { ...authForGroupAdmin, globalRole: "central_finance", roles: ["central_finance"] },
      {},
    )).toEqual({ downloadUrl: "/api/exports/register?" });
    expect(() => createRegisterCsvDownload(authForCompanyA, {})).toThrow("Forbidden");
    expect(() => createRegisterCsvDownload(null, {})).toThrow("Forbidden");
  });

  test("scopes granted-company register rows and their source/statement trace to the actual assignment company_id", async () => {
    const repository = createRegisterRepository(drizzle(appPool, { schema }));
    const filters = parseRegisterFilters({ sourceRequestNo: "SOL-1001" });

    const page = await repository.listRows(authForCompanyA, filters);

    expect(page.items).toEqual([
      expect.objectContaining({
        id: assignmentA1,
        companyId: companyA,
        sourceRequestApprovalState: "approved",
        sourceRequestDecidedAt: "2026-02-02T18:30:00.000Z",
        sourceRequestNo: "SOL-1001",
        statementLines: [
          expect.objectContaining({
            assignmentId: assignmentA1,
            companyId: companyA,
            statementPeriod: "2026-01",
          }),
        ],
      }),
    ]);
    expect(page.items.map((row) => row.companyId)).not.toContain(companyB);
    expect(page.items.map((row) => row.sourceRequestNo)).not.toContain("SOL-2001");
    expect(page.items.map((row) => row.sourceRequestDecidedAt)).not.toContain("2026-02-03T18:30:00.000Z");
    expect(page.items[0]?.statementLines).toHaveLength(1);
    const facets = await repository.facets(authForCompanyA);
    expect(facets).toEqual({
      companies: [{ id: companyA, label: "Alpha Company (ALP)" }],
      endReasons: ["inactive", "left_company"],
      licenseTypes: [
        { id: licenseTypeA, label: "Enterprise" },
        { id: licenseTypeB, label: "Standard" },
      ],
      people: [
        { id: personA1, label: "Alicia, \"Quoted\"\r\nCell" },
        { id: personA2, label: "Bruno Import" },
        { id: personA3, label: "Carla Reconciliation" },
      ],
      sourceRequestNos: ["SOL-1001"],
      vendorAccounts: [{ id: vendorAccountA, label: "Register Org A" }],
    });

    const groupPage = await repository.listRows(
      authForGroupAdmin,
      parseRegisterFilters({ openState: "open" }),
    );
    expect(groupPage.items.map((row) => row.companyId)).toEqual([companyA, companyB]);
  });

  test("applies parsed vendor, license, person, source, date, state, end-reason filters with stable cursor pagination", async () => {
    const repository = createRegisterRepository(drizzle(appPool, { schema }));
    const closedImport = parseRegisterFilters({
      companyId: companyA,
      vendorAccountId: vendorAccountA,
      licenseTypeId: licenseTypeA,
      personId: personA2,
      sourceKind: "import",
      openState: "closed",
      endReason: "inactive",
      startDate: "2026-02-01",
      endDate: "2026-02-01",
    });

    await expect(repository.listRows(authForCompanyA, closedImport)).resolves.toEqual({
      items: [expect.objectContaining({ id: assignmentA2, note: " =initial import" })],
      nextCursor: null,
    });

    const first = await repository.listRows(
      authForCompanyA,
      parseRegisterFilters({ limit: "2" }),
    );
    const second = await repository.listRows(
      authForCompanyA,
      parseRegisterFilters({ limit: "2", cursor: first.nextCursor ?? "" }),
    );
    expect(first.items.map((row) => row.id)).toEqual([assignmentA1, assignmentA2]);
    expect(second.items.map((row) => row.id)).toEqual([assignmentA3]);
    expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(3);
  });

  test.each([
    ["company", { companyId: companyB }, authForGroupAdmin, [assignmentB]],
    ["vendor account", { vendorAccountId: vendorAccountB }, authForGroupAdmin, [assignmentB]],
    ["license type", { licenseTypeId: licenseTypeB }, authForCompanyA, [assignmentA3]],
    ["person", { personId: personA2 }, authForCompanyA, [assignmentA2]],
    ["source kind", { sourceKind: "reconciliation" }, authForCompanyA, [assignmentA3]],
    ["source request", { sourceRequestNo: "SOL-1001" }, authForCompanyA, [assignmentA1]],
    ["open state", { openState: "open" }, authForCompanyA, [assignmentA1]],
    ["closed state", { openState: "closed" }, authForCompanyA, [assignmentA2, assignmentA3]],
    ["end reason", { endReason: "left_company" }, authForCompanyA, [assignmentA3]],
    ["start date", { startDate: "2026-02-01" }, authForCompanyA, [assignmentA2, assignmentA3]],
    ["end date", { endDate: "2026-02-01" }, authForCompanyA, [assignmentA1, assignmentA2]],
  ] as const)("enforces the %s filter independently", async (_name, input, authorization, expectedIds) => {
    const repository = createRegisterRepository(drizzle(appPool, { schema }));
    const page = await repository.listRows(authorization, parseRegisterFilters(input));
    expect(page.items.map((row) => row.id)).toEqual(expectedIds);
  });

  test("returns an empty page for an authorized scope with no matching rows", async () => {
    const repository = createRegisterRepository(drizzle(appPool, { schema }));
    await expect(repository.listRows(authForCompanyA, parseRegisterFilters({ sourceRequestNo: "SOL-404" }))).resolves.toEqual({ items: [], nextCursor: null });
  });

  test("rejects every malformed cursor component before issuing a database query", async () => {
    const repository = createRegisterRepository(drizzle(appPool, { schema }));
    const cursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    await expect(repository.listRows(
      authForCompanyA,
      parseRegisterFilters({ cursor: "not-json" }),
    )).rejects.toThrow("Invalid register cursor encoding");
    for (const malformed of [
      cursor(null),
      cursor([]),
      cursor({}),
      cursor({ id: 42, startedOn: "2026-01-01" }),
      cursor({ id: "not-a-uuid", startedOn: "2026-01-01" }),
      cursor({ id: assignmentA1, startedOn: 42 }),
      cursor({ id: assignmentA1, startedOn: "2026-1-01" }),
      cursor({ id: assignmentA1, startedOn: "2026-02-30" }),
    ]) {
      await expect(repository.listRows(
        authForCompanyA,
        parseRegisterFilters({ cursor: malformed }),
      )).rejects.toThrow("Invalid register cursor");
    }
  });

  test("fails closed when finance access has no permitted company", async () => {
    const repository = createRegisterRepository(drizzle(appPool, { schema }));
    const noScope: LedgerAuthorization = {
      ...authForCompanyA,
      companyGrants: [],
      companyIds: [],
    };
    await expect(repository.listRows(noScope, parseRegisterFilters({}))).resolves.toEqual({ items: [], nextCursor: null });
  });

  test("uses one parsed filter object for list and RFC 4180 CSV export without spreadsheet formula execution", async () => {
    const repository = createRegisterRepository(drizzle(appPool, { schema }));
    const filters = parseRegisterFilters({ companyId: companyA });

    const [page, csv] = await Promise.all([
      repository.listRows(authForCompanyA, filters),
      repository.exportCsv(authForCompanyA, filters),
    ]);

    expect(serializeRegisterFilters(filters)).toBe("companyId=00000000-0000-4000-8000-000000003302");
    expect(csv).toContain('"Alicia, ""Quoted""\r\nCell"');
    expect(csv).toContain("' =initial import");
    expect(csv).toContain("'+reconciled");
    expect(csv).toContain("register_v1,\"Alicia, \"\"Quoted\"\"\r\nCell\",ALP,Register Org A,Enterprise,2026-01-01,,,request,SOL-1001,");
    expect(csv.slice(0, csv.indexOf("\r\n") + 2)).toBe(
      "schema_version,person_name,company_code,vendor_account_name,license_type_name,started_on,ended_on,end_reason,source_kind,source_request_no,note\r\n",
    );
    expect(csv).not.toContain("Bravo Tenant");
    expect(countCsvRecords(csv)).toBe(page.items.length + 1);
  });

  test("exports the complete filtered register even when the page supplied a cursor", async () => {
    const repository = createRegisterRepository(drizzle(appPool, { schema }));
    const first = await repository.listRows(
      authForCompanyA,
      parseRegisterFilters({ limit: "1" }),
    );
    const csv = await repository.exportCsv(
      authForCompanyA,
      parseRegisterFilters({ cursor: first.nextCursor ?? "" }),
    );
    expect(countCsvRecords(csv)).toBe(4);
    expect(csv).toContain("Alicia");
    expect(csv).toContain("Bruno Import");
    expect(csv).toContain("Carla Reconciliation");
  });

  test("does not invent a cursor when a page exactly fills its requested limit", async () => {
    const repository = createRegisterRepository(drizzle(appPool, { schema }));
    await expect(repository.listRows(authForCompanyA, parseRegisterFilters({ limit: "3" }))).resolves.toEqual({
      items: [
        expect.objectContaining({ id: assignmentA1 }),
        expect.objectContaining({ id: assignmentA2 }),
        expect.objectContaining({ id: assignmentA3 }),
      ],
      nextCursor: null,
    });
  });

  test("streams every keyset batch in order and terminates after the final cursor", async () => {
    await owner.query(`
      INSERT INTO license_assignment (id, person_id, company_id, vendor_account_id, license_type_id,
                                      started_on, ended_on, end_reason, source_kind, created_at, created_by)
      SELECT
        ('00000000-0000-4000-9000-' || lpad(series::text, 12, '0'))::uuid,
        $1, $2, $3, $4, (DATE '2026-04-01' + series)::date,
        (DATE '2026-04-01' + series)::date, 'inactive', 'import', $5, $6
      FROM generate_series(1, 101) AS series
    `, [personA2, companyA, vendorAccountA, licenseTypeA, new Date("2026-07-28T00:00:00.000Z"), actorId]);
    const repository = createRegisterRepository(drizzle(appPool, { schema }));
    let csv = "";
    const chunks: string[] = [];
    for await (const chunk of repository.streamCsv(authForCompanyA, parseRegisterFilters({ companyId: companyA }))) {
      chunks.push(chunk);
      csv += chunk;
    }
    expect(chunks.map(countCsvRecords)).toEqual([1, 100, 4]);
    expect(countCsvRecords(csv)).toBe(105);
    expect((csv.match(/Bruno Import/g) ?? []).length).toBe(102);
    expect(csv.indexOf("2026-03-01")).toBeLessThan(csv.indexOf("2026-04-02"));
  });

  test("streams exactly one header chunk when authorized filters match no rows", async () => {
    const repository = createRegisterRepository(drizzle(appPool, { schema }));
    const chunks: string[] = [];
    for await (const chunk of repository.streamCsv(
      authForCompanyA,
      parseRegisterFilters({ sourceRequestNo: "SOL-404" }),
    )) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([
      "schema_version,person_name,company_code,vendor_account_name,license_type_name,started_on,ended_on,end_reason,source_kind,source_request_no,note\r\n",
      "",
    ]);
  });

  test("derives pending, approved, rejected, and absent request approval traces", async () => {
    const repository = createRegisterRepository(drizzle(appPool, { schema }));
    const all = await repository.listRows(authForGroupAdmin, parseRegisterFilters({}));
    expect(all.items.find((row) => row.id === assignmentA1)).toMatchObject({
      sourceRequestApprovalState: "approved",
      sourceRequestDecidedAt: "2026-02-02T18:30:00.000Z",
    });
    expect(all.items.find((row) => row.id === assignmentB)).toMatchObject({
      sourceRequestApprovalState: "rejected",
      sourceRequestDecidedAt: "2026-02-03T18:30:00.000Z",
    });
    expect(all.items.find((row) => row.id === assignmentA2)).toMatchObject({
      sourceRequestApprovalState: null,
      sourceRequestDecidedAt: null,
      statementLines: [],
    });

    await owner.query("UPDATE license_request SET decided_at = NULL WHERE id = $1", [requestA]);
    const pending = await repository.listRows(
      authForGroupAdmin,
      parseRegisterFilters({ sourceRequestNo: "SOL-1001" }),
    );
    expect(pending.items[0]).toMatchObject({
      sourceRequestApprovalState: "pending",
      sourceRequestDecidedAt: null,
    });
  });

  test("rejects unsafe, duplicate, unknown, and oversized export parameters fail-closed", () => {
    expect(() => parseRegisterFilters({ companyId: [companyA, companyB] })).toThrow("Invalid register filters");
    expect(() => parseRegisterFilters({ unknown: "value" })).toThrow("Invalid register filters");
    expect(() => parseRegisterFilters({ sourceRequestNo: "x".repeat(201) })).toThrow("Invalid register filters");
  });

  test("reparses canonical filters and returns only database-authorized CSV rows at the download boundary", async () => {
    const database = drizzle(appPool, { schema });
    const authorizationRepository = createAuthorizationRepository(database);
    const repository = createRegisterRepository(database);
    const canonical = serializeRegisterFilters(parseRegisterFilters({ companyId: companyA, sourceRequestNo: "SOL-1001" }));
    const unauthenticated = await createRegisterExportResponse({ loadAuthorization: async (subject) => authorizationRepository.load({ subject }), query: new URLSearchParams(canonical), queryLength: canonical.length, repository, subject: null });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("content-type")).toBe("application/json");
    await expect(unauthenticated.json()).resolves.toEqual({ error: "Unauthorized" });

    const forbidden = await createRegisterExportResponse({ loadAuthorization: async (subject) => authorizationRepository.load({ subject }), query: new URLSearchParams(canonical), queryLength: canonical.length, repository, subject: "register-viewer" });
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("content-type")).toBe("application/json");
    await expect(forbidden.json()).resolves.toEqual({ error: "Forbidden" });

    const companyFinance = await createRegisterExportResponse({ loadAuthorization: async (subject) => authorizationRepository.load({ subject }), query: new URLSearchParams(canonical), queryLength: canonical.length, repository, subject: "register-finance-a" });
    expect(companyFinance.status).toBe(403);
    await expect(companyFinance.json()).resolves.toEqual({ error: "Forbidden" });
    const authorized = await createRegisterExportResponse({ loadAuthorization: async (subject) => authorizationRepository.load({ subject }), query: new URLSearchParams(canonical), queryLength: canonical.length, repository, subject: "register-admin" });
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(authorized.headers.get("content-disposition")).toBe('attachment; filename="register.csv"');
    expect(authorized.headers.get("cache-control")).toBe("private, no-store");
    await expect(authorized.text()).resolves.toContain("SOL-1001");

    for (const query of [
      new URLSearchParams([["companyId", companyA], ["companyId", companyB]]),
      new URLSearchParams([["companyId", companyA], ["sourceRequestNo", "SOL-1001"], ["companyId", companyB]]),
    ]) {
      const duplicate = await createRegisterExportResponse({ loadAuthorization: async (subject) => authorizationRepository.load({ subject }), query, queryLength: 2, repository, subject: "register-admin" });
      expect(duplicate.status).toBe(400);
      await expect(duplicate.json()).resolves.toEqual({ error: "Invalid register filters" });
    }
    const oversized = await createRegisterExportResponse({ loadAuthorization: async (subject) => authorizationRepository.load({ subject }), query: new URLSearchParams(canonical), queryLength: 4097, repository, subject: "register-admin" });
    expect(oversized.status).toBe(400);
    await expect(oversized.json()).resolves.toEqual({ error: "Invalid register filters" });
    const exactLimit = await createRegisterExportResponse({ loadAuthorization: async (subject) => authorizationRepository.load({ subject }), query: new URLSearchParams(canonical), queryLength: 4096, repository, subject: "register-admin" });
    expect(exactLimit.status).toBe(200);
    await exactLimit.body?.cancel();
    const malformed = await createRegisterExportResponse({ loadAuthorization: async (subject) => authorizationRepository.load({ subject }), query: new URLSearchParams("unknown=value"), queryLength: 13, repository, subject: "register-admin" });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({ error: "Invalid register filters" });
    const missingAuthorization = await createRegisterExportResponse({ loadAuthorization: async (subject) => authorizationRepository.load({ subject }), query: new URLSearchParams(canonical), queryLength: canonical.length, repository, subject: "not-a-user" });
    expect(missingAuthorization.status).toBe(403);
    await expect(missingAuthorization.json()).resolves.toEqual({ error: "Forbidden" });
    await owner.query("UPDATE user_account SET global_role = 'central_finance', idp_subject = 'register-central' WHERE id = $1", [actorId]);
    const centralFinance = await createRegisterExportResponse({ loadAuthorization: async (subject) => authorizationRepository.load({ subject }), query: new URLSearchParams(canonical), queryLength: canonical.length, repository, subject: "register-central" });
    expect(centralFinance.status).toBe(200);
    await centralFinance.body?.cancel();

    const companyBQuery = serializeRegisterFilters(parseRegisterFilters({ companyId: companyB }));
    const crossCompany = await createRegisterExportResponse({ loadAuthorization: async (subject) => authorizationRepository.load({ subject }), query: new URLSearchParams(companyBQuery), queryLength: companyBQuery.length, repository, subject: "register-finance-a" });
    expect(crossCompany.status).toBe(403);
  });

  test("cancels a real CSV stream and reports a real database read failure to the response reader", async () => {
    const database = drizzle(appPool, { schema });
    const authorizationRepository = createAuthorizationRepository(database);
    const repository = createRegisterRepository(database);
    const canonical = serializeRegisterFilters(parseRegisterFilters({ companyId: companyA }));
    const response = await createRegisterExportResponse({ loadAuthorization: async (subject) => authorizationRepository.load({ subject }), query: new URLSearchParams(canonical), queryLength: canonical.length, repository, subject: "register-admin" });
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("schema_version,person_name");
    await reader.cancel();

    const failingPool = new pg.Pool({ connectionString: appUrl });
    const failingDatabase = drizzle(failingPool, { schema });
    const failingRepository = createRegisterRepository(failingDatabase);
    const failingResponse = await createRegisterExportResponse({ loadAuthorization: async (subject) => authorizationRepository.load({ subject }), query: new URLSearchParams(canonical), queryLength: canonical.length, repository: failingRepository, subject: "register-admin" });
    const failingReader = failingResponse.body!.getReader();
    expect(new TextDecoder().decode((await failingReader.read()).value)).toContain("schema_version,person_name");
    await failingPool.end();
    await expect(failingReader.read()).rejects.toThrow();
  });

  test("rejects cross-company person and request joins even when foreign keys are valid", async () => {
    await owner.query("UPDATE license_assignment SET person_id = $1, source_request_id = $2 WHERE id = $3", [personB, requestB, assignmentA1]);
    const repository = createRegisterRepository(drizzle(appPool, { schema }));
    await expect(repository.listRows(authForCompanyA, parseRegisterFilters({ companyId: companyA }))).resolves.toEqual({ items: [expect.objectContaining({ id: assignmentA2 }), expect.objectContaining({ id: assignmentA3 })], nextCursor: null });
  });
});
