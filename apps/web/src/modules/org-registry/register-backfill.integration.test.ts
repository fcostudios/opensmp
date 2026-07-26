import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import {
  auditLog,
  company,
  companyRoleAssignment,
  integrationCredential,
  licenseAssignment,
  licenseRequest,
  person,
  requestTransition,
  userAccount,
  vendor,
  vendorAccount,
  vendorAccountCapacity,
} from "@smp/db/schema";
import { createPostgresFixture, type PostgresFixture } from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";

import { dryRunGoLiveImport, runGoLiveImport } from "./register-backfill";
import { seedAnthropicCatalog } from "../vendor-catalog/seeding";

const actorId = "00000000-0000-4000-8000-000000000701";
const now = new Date("2026-08-01T12:00:00.000Z");
const companiesCsv = [
  "code,name,type,approver_email,finance_contact_email,budget_monthly_usd,statement_language",
  "ACME,Acme Holdings,internal,approver@acme.test,finance@acme.test,1500.00,es",
].join("\n");
const membersCsv = [
  "vendor_org_ref,email,full_name,company_code,license_type,started_on",
  "anthropic-acme,member@acme.test,Member One,ACME,Enterprise,2026-08-01",
].join("\n");
const capacityCsv = [
  "vendor_org_ref,license_type,purchased_qty,effective_from,note",
  "anthropic-acme,Enterprise,1,2026-08-01,Synthetic capacity",
].join("\n");

describe("US-007 go-live import", () => {
  let fixture: PostgresFixture;
  let pool: pg.Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    fixture = await createPostgresFixture();
    await fixture.migrate();
    pool = new pg.Pool({ connectionString: fixture.ownerUrl });
    database = drizzle(pool, { schema });
    await database.insert(userAccount).values({
      id: actorId,
      email: "admin@ledger.test",
      globalRole: "group_admin",
      status: "active",
      createdAt: now,
    });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await fixture?.stop();
  }, 120_000);

  it("dry-runs without writes and reports the complete insert set", async () => {
    const report = await dryRunGoLiveImport(database, {
      companiesCsv,
      membersCsv,
      capacityCsv,
    });
    expect(report).toEqual({
      inserts: {
        companies: 1,
        contactAccounts: 2,
        roleAssignments: 2,
        vendorAccounts: 1,
        licenseTypes: 1,
        capacities: 1,
        people: 1,
        requests: 1,
        assignments: 1,
      },
      existing: {
        companies: 0,
        contactAccounts: 0,
        roleAssignments: 0,
        vendorAccounts: 0,
        licenseTypes: 0,
        capacities: 0,
        people: 0,
        requests: 0,
        assignments: 0,
      },
      errors: [],
    });
    expect((await database.select().from(company))).toHaveLength(0);
  });

  it("materializes contacts, requests, transition, register, capacity, and an audit atomically", async () => {
    const report = await runGoLiveImport(database, {
      actorUserId: actorId,
      companiesCsv,
      membersCsv,
      capacityCsv,
      occurredAt: now,
    });
    expect(report.reconciliation).toEqual([
      {
        vendorOrgRef: "anthropic-acme",
        licenseType: "Enterprise",
        purchased: 1,
        consoleMembers: 1,
        importedAssignments: 1,
        delta: 0,
      },
    ]);

    const [savedCompany] = await database.select().from(company);
    expect(savedCompany).toMatchObject({
      code: "ACME",
      financeContactEmail: "finance@acme.test",
      budgetMonthlyUsd: "1500.00",
      statementLanguage: "es",
    });
    expect(await database.select().from(userAccount)).toHaveLength(4);
    expect((await database.select().from(userAccount)).filter(
      (row) => ["approver@acme.test", "finance@acme.test"].includes(row.email),
    ))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ email: "approver@acme.test", status: "disabled" }),
        expect.objectContaining({ email: "finance@acme.test", status: "disabled" }),
      ]));
    expect((await database.select().from(companyRoleAssignment)).map((row) => row.role).sort())
      .toEqual(["approver", "finance"]);
    expect(await database.select().from(licenseRequest)).toEqual([
      expect.objectContaining({
        requestNo: expect.stringMatching(/^IMP-[A-F0-9]{24}$/),
        state: "active",
        justification: "importación inicial",
        requestedBy: null,
        createdBy: null,
      }),
    ]);
    expect(await database.select().from(requestTransition)).toEqual([
      expect.objectContaining({ fromState: null, toState: "active", actorUserId: null }),
    ]);
    expect(await database.select().from(licenseAssignment)).toEqual([
      expect.objectContaining({ sourceKind: "import", endedOn: null }),
    ]);
    expect(await database.select().from(vendorAccountCapacity)).toHaveLength(1);
    expect(await database.select().from(auditLog)).not.toHaveLength(0);
  });

  it("creates nothing on an identical second run", async () => {
    const before = {
      companies: (await database.select().from(company)).length,
      requests: (await database.select().from(licenseRequest)).length,
      assignments: (await database.select().from(licenseAssignment)).length,
      capacities: (await database.select().from(vendorAccountCapacity)).length,
      credentials: (await database.select().from(integrationCredential)).length,
    };
    const report = await runGoLiveImport(database, {
      actorUserId: actorId,
      companiesCsv,
      membersCsv,
      capacityCsv,
      occurredAt: now,
    });
    expect(report.created).toEqual({
      companies: 0,
      contactAccounts: 0,
      roleAssignments: 0,
      vendorAccounts: 0,
      licenseTypes: 0,
      capacities: 0,
      people: 0,
      requests: 0,
      assignments: 0,
      credentials: 0,
    });
    expect({
      companies: (await database.select().from(company)).length,
      requests: (await database.select().from(licenseRequest)).length,
      assignments: (await database.select().from(licenseAssignment)).length,
      capacities: (await database.select().from(vendorAccountCapacity)).length,
      credentials: (await database.select().from(integrationCredential)).length,
    }).toEqual(before);
  });

  it("encrypts each credential once and never persists plaintext", async () => {
    const testKek = Uint8Array.from({ length: 32 }, (_, index) => index);
    const deterministicBytes = (length: number) =>
      Uint8Array.from({ length }, (_, index) => (index + length) % 256);
    const credentialSeeds = [
        {
          vendorOrgRef: "anthropic-acme",
          kind: "admin_scoped" as const,
          plaintext: "sk-ant-admin-synthetic",
          scopes: "read:members write:members",
        },
        {
          vendorOrgRef: "anthropic-acme",
          kind: "analytics" as const,
          plaintext: "sk-ant-analytics-synthetic",
        },
      ];
    const capacityRows = [{
      vendorOrgRef: "anthropic-acme",
      licenseType: "Enterprise",
      purchasedQty: 1,
      effectiveFrom: "2026-08-01",
      note: "Synthetic capacity",
    }];
    const first = await database.transaction((transaction) =>
      seedAnthropicCatalog(
        transaction,
        capacityRows,
        actorId,
        now,
        credentialSeeds,
        testKek,
        deterministicBytes,
      ));
    const credentials = await database.select().from(integrationCredential);
    expect(first.credentials).toBe(2);
    expect(credentials).toHaveLength(2);
    expect(credentials.map((row) => row.kind).sort()).toEqual([
      "admin_scoped",
      "analytics",
    ]);
    expect(JSON.stringify(credentials)).not.toContain("sk-ant-");
    const second = await database.transaction((transaction) =>
      seedAnthropicCatalog(
        transaction,
        capacityRows,
        actorId,
        now,
        credentialSeeds,
        testKek,
        deterministicBytes,
      ));
    expect(second.credentials).toBe(0);
    expect(await database.select().from(integrationCredential)).toHaveLength(2);
  });

  it("rolls back the entire batch when reconciliation is non-zero", async () => {
    const beforePeople = (await database.select().from(person)).length;
    const beforeRequests = (await database.select().from(licenseRequest)).length;
    const twoMembers = [
      membersCsv,
      "anthropic-acme,second@acme.test,Member Two,ACME,Enterprise,2026-08-01",
    ].join("\n");
    const excessCapacity = capacityCsv
      .replace(",1,2026", ",3,2026")
      .replace("2026-08-01,Synthetic", "2026-08-02,Synthetic");
    await expect(runGoLiveImport(database, {
      actorUserId: actorId,
      companiesCsv,
      membersCsv: twoMembers,
      capacityCsv: excessCapacity,
      occurredAt: now,
    })).rejects.toThrow(/reconciliation failed/i);
    expect((await database.select().from(person)).length).toBe(beforePeople);
    expect((await database.select().from(licenseRequest)).length).toBe(beforeRequests);
  });

  it("reports changed natural-key rows and conflicting member identities", async () => {
    const changedCapacity = capacityCsv.replace(",1,2026", ",2,2026");
    const changedMember = membersCsv.replace("Member One", "A Different Person");
    const report = await dryRunGoLiveImport(database, {
      companiesCsv,
      membersCsv: changedMember,
      capacityCsv: changedCapacity,
    });
    expect(report.errors).toEqual(expect.arrayContaining([
      "Capacity anthropic-acme/Enterprise/2026-08-01 conflicts with its existing record",
      "Member member@acme.test conflicts with its existing identity",
    ]));
  });

  it("enforces vendor-org and active-credential natural keys in PostgreSQL", async () => {
    const [anthropic] = await database.select().from(vendor);
    const [account] = await database.select().from(vendorAccount);
    await expect(async () => {
      await pool.query(
        `INSERT INTO vendor_account
          (vendor_id, name, mode, vendor_org_ref, low_pool_floor, status, created_at, created_by)
         VALUES ($1, 'Duplicate ref', 'automated', $2, 5, 'active', $3, $4)`,
        [anthropic.id, account.vendorOrgRef, now, actorId],
      );
    }).rejects.toMatchObject({ code: "23505" });
    await expect(async () => {
      await pool.query(
        `INSERT INTO integration_credential
          (vendor_account_id, kind, encrypted_secret, health, status, created_at, created_by)
         VALUES ($1, 'admin_scoped', 'synthetic-envelope', 'unverified', 'active', $2, $3)`,
        [account.id, now, actorId],
      );
    }).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects unknown references before mutation", async () => {
    const badMembers = membersCsv.replace("ACME,Enterprise", "MISSING,Enterprise");
    const report = await dryRunGoLiveImport(database, {
      companiesCsv,
      membersCsv: badMembers,
      capacityCsv,
    });
    expect(report.errors).toContain(
      "Member member@acme.test references unknown company MISSING",
    );
  });
});
