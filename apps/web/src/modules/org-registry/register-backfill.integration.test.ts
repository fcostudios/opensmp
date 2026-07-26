import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import pg from "pg";

import {
  auditLog,
  company,
  companyRoleAssignment,
  integrationCredential,
  licenseAssignment,
  licenseRequest,
  licenseType,
  person,
  requestTransition,
  userAccount,
  vendor,
  vendorAccount,
  vendorAccountCapacity,
} from "@smp/db/schema";
import { createPostgresFixture, type PostgresFixture } from "@smp/db/testing/postgres-container";
import * as schema from "@smp/db/schema";

import {
  dryRunGoLiveImport,
  GO_LIVE_IMPORT_LOCK,
  runGoLiveImport,
} from "./register-backfill-transaction";

const actorId = "00000000-0000-4000-8000-000000000701";
const now = new Date("2026-08-01T12:00:00.000Z");
const companyRows = Array.from({ length: 30 }, (_, index) => {
  const ordinal = index + 1;
  const code = index === 0 ? "ACME" : `C${String(ordinal).padStart(3, "0")}`;
  return [
    code,
    index === 0 ? "Acme Holdings" : `Synthetic Company ${ordinal}`,
    "internal",
    `approver${ordinal}@example.invalid`,
    `finance${ordinal}@example.invalid`,
    index === 0 ? "1500.00" : "1000.00",
    index % 2 === 0 ? "es" : "en",
  ].join(",");
});
const companiesCsv = [
  "code,name,type,approver_email,finance_contact_email,budget_monthly_usd,statement_language",
  ...companyRows,
].join("\n");
const membersCsv = [
  "vendor_org_ref,email,full_name,company_code,license_type,started_on",
  "anthropic-acme,member@acme.test,Member One,ACME,Enterprise,2026-08-01",
  "anthropic-acme,member2@example.invalid,Member Two,C002,Enterprise,2026-08-01",
].join("\n");
const capacityCsv = [
  "vendor_org_ref,license_type,purchased_qty,effective_from,note",
  "anthropic-acme,Enterprise,3,2026-08-01,Synthetic capacity with one spare seat",
].join("\n");
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

describe("US-007 go-live import", () => {
  let fixture: PostgresFixture;
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let ownerDatabase: ReturnType<typeof drizzle<typeof schema>>;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    fixture = await createPostgresFixture();
    await fixture.migrate();
    ownerPool = new pg.Pool({ connectionString: fixture.ownerUrl });
    appPool = new pg.Pool({ connectionString: fixture.appUrl });
    ownerDatabase = drizzle(ownerPool, { schema });
    database = drizzle(appPool, { schema });
  }, 120_000);

  beforeEach(async () => {
    await ownerPool.query(`
      TRUNCATE TABLE
        audit_log,
        request_transition,
        license_assignment,
        license_request,
        integration_credential,
        vendor_account_capacity,
        vendor_account,
        license_type,
        vendor,
        company_role_assignment,
        user_account,
        person,
        company
      RESTART IDENTITY CASCADE
    `);
    await ownerDatabase.insert(userAccount).values({
      id: actorId,
      email: "admin@ledger.test",
      globalRole: "group_admin",
      status: "active",
      createdAt: now,
    });
  });

  const importBaseline = () => runGoLiveImport(database, {
    actorUserId: actorId,
    companiesCsv,
    membersCsv,
    capacityCsv,
    occurredAt: now,
    credentials: credentialSeeds,
    kek: testKek,
    randomBytes: deterministicBytes,
  });

  afterAll(async () => {
    await appPool?.end();
    await ownerPool?.end();
    await fixture?.stop();
  }, 120_000);

  it("dry-runs without writes and reports the complete insert set", async () => {
    const report = await dryRunGoLiveImport(
      database,
      { companiesCsv, membersCsv, capacityCsv },
      credentialSeeds,
    );
    expect(report).toEqual({
      inserts: {
        companies: 30,
        contactAccounts: 60,
        roleAssignments: 60,
        vendorAccounts: 1,
        licenseTypes: 1,
        capacities: 1,
        people: 2,
        requests: 2,
        assignments: 2,
        credentials: 2,
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
        credentials: 0,
      },
      errors: [],
    });
    expect((await database.select().from(company))).toHaveLength(0);
  });

  it("materializes contacts, requests, transition, register, capacity, and an audit atomically", async () => {
    expect((await appPool.query<{ current_user: string }>(
      "SELECT current_user",
    )).rows[0]?.current_user).toBe("ledger_app");
    const report = await runGoLiveImport(database, {
      actorUserId: actorId,
      companiesCsv,
      membersCsv,
      capacityCsv,
      occurredAt: now,
      credentials: credentialSeeds,
      kek: testKek,
      randomBytes: deterministicBytes,
    });
    expect(report.reconciliation).toEqual([
      {
        vendorOrgRef: "anthropic-acme",
        licenseType: "Enterprise",
        purchased: 3,
        consoleMembers: 2,
        importedAssignments: 2,
        persistedCapacity: 3,
        memberDelta: 0,
        capacityDelta: 0,
      },
    ]);

    const [savedCompany] = await database.select().from(company);
    expect(savedCompany).toMatchObject({
      code: "ACME",
      financeContactEmail: "finance1@example.invalid",
      budgetMonthlyUsd: "1500.00",
      statementLanguage: "es",
    });
    expect(await database.select().from(userAccount)).toHaveLength(61);
    expect((await database.select().from(userAccount)).filter(
      (row) => ["approver1@example.invalid", "finance1@example.invalid"].includes(row.email),
    ))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ email: "approver1@example.invalid", status: "disabled" }),
        expect.objectContaining({ email: "finance1@example.invalid", status: "disabled" }),
      ]));
    expect((await database.select().from(companyRoleAssignment)).map((row) => row.role).sort())
      .toHaveLength(60);
    expect(await database.select().from(licenseRequest)).toEqual(
      expect.arrayContaining([expect.objectContaining({
        requestNo: expect.stringMatching(/^IMP-[A-F0-9]{24}$/),
        state: "active",
        justification: "importación inicial",
        requestedBy: null,
        createdBy: null,
      })]),
    );
    expect(await database.select().from(requestTransition)).toHaveLength(2);
    expect(await database.select().from(licenseAssignment)).toHaveLength(2);
    expect(await database.select().from(vendorAccountCapacity)).toHaveLength(1);
    expect(await database.select().from(auditLog)).not.toHaveLength(0);
  });

  it("creates nothing on an identical second run", async () => {
    await importBaseline();
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
      credentials: credentialSeeds,
      kek: testKek,
      randomBytes: deterministicBytes,
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
    await importBaseline();
    const credentials = await database.select().from(integrationCredential);
    expect(credentials).toHaveLength(2);
    expect(credentials.map((row) => row.kind).sort()).toEqual([
      "admin_scoped",
      "analytics",
    ]);
    expect(JSON.stringify(credentials)).not.toContain("sk-ant-");
    const existingPreview = await dryRunGoLiveImport(
      database,
      { companiesCsv, membersCsv, capacityCsv },
      credentialSeeds,
      testKek,
    );
    expect(existingPreview.existing.credentials).toBe(2);
    expect(existingPreview.errors).toEqual([]);
    const conflictPreview = await dryRunGoLiveImport(
      database,
      { companiesCsv, membersCsv, capacityCsv },
      [
        { ...credentialSeeds[0], plaintext: "different-secret-synthetic" },
        credentialSeeds[1],
      ],
      testKek,
    );
    expect(conflictPreview.errors).toContain(
      "Credential anthropic-acme/admin_scoped conflicts with its active record",
    );
    const second = await runGoLiveImport(database, {
      actorUserId: actorId,
      companiesCsv,
      membersCsv,
      capacityCsv,
      occurredAt: now,
      credentials: credentialSeeds,
      kek: testKek,
      randomBytes: deterministicBytes,
    });
    expect(second.created.credentials).toBe(0);
    expect(await database.select().from(integrationCredential)).toHaveLength(2);
  });

  it("rolls back catalog rows when credential encryption fails inside the batch", async () => {
    const beforeAccounts = (await database.select().from(vendorAccount)).length;
    const additionalCapacity = [
      capacityCsv,
      "org-failing,Team,0,2026-08-01,Synthetic rollback pool",
    ].join("\n");
    await expect(runGoLiveImport(database, {
      actorUserId: actorId,
      companiesCsv,
      membersCsv,
      capacityCsv: additionalCapacity,
      occurredAt: now,
      kek: Uint8Array.from({ length: 32 }, (_, index) => index),
      credentials: [{
        vendorOrgRef: "org-failing",
        kind: "admin_scoped",
        plaintext: "synthetic-failing-key",
      }],
      randomBytes: () => new Uint8Array(1),
    })).rejects.toThrow();
    expect(await database.select().from(vendorAccount)).toHaveLength(beforeAccounts);
  });

  it("reports changed natural-key rows and conflicting member identities", async () => {
    await importBaseline();
    const changedCapacity = capacityCsv.replace(",3,2026", ",2,2026");
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

  it("reports the exact idempotent dry-run state when credentials are omitted", async () => {
    await importBaseline();

    const report = await dryRunGoLiveImport(database, {
      companiesCsv,
      membersCsv,
      capacityCsv,
    });

    expect(report).toEqual({
      inserts: {
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
      },
      existing: {
        companies: 30,
        contactAccounts: 60,
        roleAssignments: 60,
        vendorAccounts: 1,
        licenseTypes: 1,
        capacities: 1,
        people: 2,
        requests: 2,
        assignments: 2,
        credentials: 0,
      },
      errors: [],
    });
  });

  it("ignores matching catalog references owned by a different vendor", async () => {
    const [otherVendor] = await ownerDatabase.insert(vendor).values({
      name: "Other synthetic vendor",
      connectorType: "manual",
      provisioningProtocol: "none",
      canProvision: false,
      canDeprovision: false,
      hasUsageData: false,
      hasCostData: false,
      identityMatching: "email",
      status: "active",
      createdAt: now,
      createdBy: actorId,
    }).returning();
    await ownerDatabase.insert(vendorAccount).values({
      vendorId: otherVendor.id,
      name: "Foreign account",
      mode: "orchestration",
      vendorOrgRef: "anthropic-acme",
      lowPoolFloor: 0,
      status: "active",
      createdAt: now,
      createdBy: actorId,
    });
    await ownerDatabase.insert(licenseType).values({
      vendorId: otherVendor.id,
      name: "Enterprise",
      unit: "seat",
      status: "active",
      createdAt: now,
      createdBy: actorId,
    });

    const report = await dryRunGoLiveImport(database, {
      companiesCsv,
      membersCsv,
      capacityCsv,
    });

    expect(report.existing.vendorAccounts).toBe(0);
    expect(report.existing.licenseTypes).toBe(0);
    expect(report.inserts.vendorAccounts).toBe(1);
    expect(report.inserts.licenseTypes).toBe(1);
    expect(report.errors).toEqual([]);
  });

  it("enforces vendor-org and active-credential natural keys in PostgreSQL", async () => {
    await importBaseline();
    const [anthropic] = await database.select().from(vendor);
    const [account] = await database.select().from(vendorAccount);
    await expect(async () => {
      await ownerPool.query(
        `INSERT INTO vendor_account
          (vendor_id, name, mode, vendor_org_ref, low_pool_floor, status, created_at, created_by)
         VALUES ($1, 'Duplicate ref', 'automated', $2, 5, 'active', $3, $4)`,
        [anthropic.id, account.vendorOrgRef, now, actorId],
      );
    }).rejects.toMatchObject({ code: "23505" });
    await expect(async () => {
      await ownerPool.query(
        `INSERT INTO integration_credential
          (vendor_account_id, kind, encrypted_secret, health, status, created_at, created_by)
         VALUES ($1, 'admin_scoped', 'synthetic-envelope', 'unverified', 'active', $2, $3)`,
        [account.id, now, actorId],
      );
    }).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects unknown references before mutation", async () => {
    const badMembers = membersCsv
      .replace("ACME,Enterprise", "MISSING,Enterprise")
      .replace("C002,Enterprise", "C002,Team");
    const report = await dryRunGoLiveImport(database, {
      companiesCsv,
      membersCsv: badMembers,
      capacityCsv,
    });
    expect(report.errors).toContain(
      "Member member@acme.test references unknown company MISSING",
    );
    expect(report.errors).toContain(
      "Member member2@example.invalid references unknown vendor org/license type anthropic-acme/Team",
    );
  });

  it("rejects any go-live inventory that does not contain exactly 30 companies", async () => {
    const report = await dryRunGoLiveImport(database, {
      companiesCsv: companiesCsv.split("\n").slice(0, -1).join("\n"),
      membersCsv,
      capacityCsv,
    });
    expect(report.errors).toContain(
      "Go-live company inventory must contain exactly 30 companies; received 29",
    );
  });

  it("rejects a new-company contact already represented by any Person", async () => {
    await importBaseline();
    const replacement = [
      ...companyRows.slice(0, -1),
      "NEW,New Synthetic Company,internal,member@acme.test,new-finance@example.invalid,1000.00,es",
    ];
    const report = await dryRunGoLiveImport(database, {
      companiesCsv: [
        "code,name,type,approver_email,finance_contact_email,budget_monthly_usd,statement_language",
        ...replacement,
      ].join("\n"),
      membersCsv,
      capacityCsv,
    });
    expect(report.errors).toContain(
      "Contact member@acme.test conflicts with an existing Person",
    );
  });

  it("rejects a linked contact account whose Person belongs to another incoming company", async () => {
    await importBaseline();
    const [acme] = await ownerDatabase
      .select()
      .from(company)
      .where(eq(company.code, "ACME"));
    const [linkedPerson] = await ownerDatabase.insert(person).values({
      email: "linked-person@example.invalid",
      fullName: "Linked Person",
      companyId: acme.id,
      status: "active",
      createdAt: now,
      createdBy: actorId,
    }).returning();
    await ownerDatabase.insert(userAccount).values({
      email: "incoming-approver@example.invalid",
      personId: linkedPerson.id,
      status: "disabled",
      createdAt: now,
      createdBy: actorId,
    });
    try {
      const replacement = [
        ...companyRows.slice(0, -1),
        "NEW,New Synthetic Company,internal,incoming-approver@example.invalid,incoming-finance@example.invalid,1000.00,es",
      ];
      const report = await dryRunGoLiveImport(database, {
        companiesCsv: [
          "code,name,type,approver_email,finance_contact_email,budget_monthly_usd,statement_language",
          ...replacement,
        ].join("\n"),
        membersCsv,
        capacityCsv,
      });
      expect(report.errors).toContain(
        "Contact incoming-approver@example.invalid conflicts with an identity in another company",
      );
    } finally {
      await ownerDatabase
        .delete(userAccount)
        .where(eq(userAccount.email, "incoming-approver@example.invalid"));
      await ownerDatabase.delete(person).where(eq(person.id, linkedPerson.id));
    }
  });

  it("rejects an existing member Person assigned to a new incoming company", async () => {
    await importBaseline();
    const [acme] = await ownerDatabase
      .select()
      .from(company)
      .where(eq(company.code, "ACME"));
    const [existingPerson] = await ownerDatabase.insert(person).values({
      email: "incoming-member@example.invalid",
      fullName: "Incoming Member",
      companyId: acme.id,
      status: "active",
      createdAt: now,
      createdBy: actorId,
    }).returning();
    try {
      const replacement = [
        ...companyRows.slice(0, -1),
        "NEW,New Synthetic Company,internal,new-approver@example.invalid,new-finance@example.invalid,1000.00,es",
      ];
      const report = await dryRunGoLiveImport(database, {
        companiesCsv: [
          "code,name,type,approver_email,finance_contact_email,budget_monthly_usd,statement_language",
          ...replacement,
        ].join("\n"),
        membersCsv: [
          "vendor_org_ref,email,full_name,company_code,license_type,started_on",
          "anthropic-acme,incoming-member@example.invalid,Incoming Member,NEW,Enterprise,2026-08-01",
        ].join("\n"),
        capacityCsv,
      });
      expect(report.errors).toContain(
        "Member incoming-member@example.invalid conflicts with another company",
      );
    } finally {
      await ownerDatabase.delete(person).where(eq(person.id, existingPerson.id));
    }
  });

  it("rejects drift independently across request, transition, and assignment lineage", async () => {
    await importBaseline();
    const [request] = await ownerDatabase.select().from(licenseRequest);
    const [assignment] = await ownerDatabase
      .select()
      .from(licenseAssignment)
      .where(eq(licenseAssignment.sourceRequestId, request.id));
    const expectedError =
      `Import lineage ${request.requestNo} conflicts with its existing request, transition, or assignment`;
    try {
      await ownerDatabase
        .update(licenseRequest)
        .set({ decisionComment: "unexpected decision" })
        .where(eq(licenseRequest.id, request.id));
      const requestDrift = await dryRunGoLiveImport(database, {
        companiesCsv,
        membersCsv,
        capacityCsv,
      });
      expect(requestDrift.errors).toContain(expectedError);
      await ownerDatabase
        .update(licenseRequest)
        .set({ decisionComment: null })
        .where(eq(licenseRequest.id, request.id));

      await ownerDatabase
        .update(licenseAssignment)
        .set({ note: "unexpected assignment" })
        .where(eq(licenseAssignment.id, assignment.id));
      const assignmentDrift = await dryRunGoLiveImport(database, {
        companiesCsv,
        membersCsv,
        capacityCsv,
      });
      expect(assignmentDrift.errors).toContain(expectedError);
      await ownerDatabase
        .update(licenseAssignment)
        .set({ note: "importación inicial" })
        .where(eq(licenseAssignment.id, assignment.id));

      await ownerDatabase.insert(requestTransition).values({
        requestId: request.id,
        fromState: null,
        toState: "active",
        actorUserId: null,
        note: "unexpected duplicate transition",
        occurredAt: now,
      });
      const transitionDrift = await dryRunGoLiveImport(database, {
        companiesCsv,
        membersCsv,
        capacityCsv,
      });
      expect(transitionDrift.errors).toContain(expectedError);
    } finally {
      await ownerDatabase
        .update(licenseRequest)
        .set({ decisionComment: null })
        .where(eq(licenseRequest.id, request.id));
      await ownerDatabase
        .update(licenseAssignment)
        .set({ note: "importación inicial" })
        .where(eq(licenseAssignment.id, assignment.id));
    }
  });

  it("keeps imported register rows isolated across two companies", async () => {
    await importBaseline();
    const savedCompanies = await database.select().from(company);
    const acme = savedCompanies.find((row) => row.code === "ACME")!;
    const second = savedCompanies.find((row) => row.code === "C002")!;
    const acmeAssignments = await database
      .select()
      .from(licenseAssignment)
      .where(eq(licenseAssignment.companyId, acme.id));
    const secondAssignments = await database
      .select()
      .from(licenseAssignment)
      .where(eq(licenseAssignment.companyId, second.id));
    expect(acmeAssignments).toHaveLength(1);
    expect(secondAssignments).toHaveLength(1);
    expect(acmeAssignments[0]?.personId).not.toBe(secondAssignments[0]?.personId);
    expect(acmeAssignments.every((row) => row.companyId === acme.id)).toBe(true);
    expect(secondAssignments.every((row) => row.companyId === second.id)).toBe(true);
  });

  it("keeps deterministic request identities distinct across field-boundary collisions", async () => {
    const collisionMembersCsv = [
      "vendor_org_ref,email,full_name,company_code,license_type,started_on",
      "ab,c@x.com,Boundary One,ACME,Enterprise,2026-08-01",
      "a,bc@x.com,Boundary Two,ACME,Enterprise,2026-08-01",
    ].join("\n");
    const collisionCapacityCsv = [
      "vendor_org_ref,license_type,purchased_qty,effective_from,note",
      "ab,Enterprise,1,2026-08-01,First boundary-sensitive pool",
      "a,Enterprise,1,2026-08-01,Second boundary-sensitive pool",
    ].join("\n");

    const result = await runGoLiveImport(database, {
      actorUserId: actorId,
      companiesCsv,
      membersCsv: collisionMembersCsv,
      capacityCsv: collisionCapacityCsv,
      occurredAt: now,
    });

    expect(result.created.requests).toBe(2);
    expect(result.created.assignments).toBe(2);
  });

  it("serializes concurrent identical imports into one create and one idempotent success", async () => {
    expect(GO_LIVE_IMPORT_LOCK).toBe("ledger:go-live-import:v1");
    const input = {
      actorUserId: actorId,
      companiesCsv,
      membersCsv,
      capacityCsv,
      occurredAt: now,
      credentials: credentialSeeds,
      kek: testKek,
      randomBytes: deterministicBytes,
    };

    const results = await Promise.all([
      runGoLiveImport(database, input),
      runGoLiveImport(database, input),
    ]);

    const zeroCreated = results.find((result) => result.created.companies === 0);
    const creating = results.find((result) => result.created.companies === 30);
    expect(zeroCreated?.created).toEqual({
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
    expect(creating?.created).toEqual({
      companies: 30,
      contactAccounts: 60,
      roleAssignments: 60,
      vendorAccounts: 1,
      licenseTypes: 1,
      capacities: 1,
      people: 2,
      requests: 2,
      assignments: 2,
      credentials: 2,
    });
    expect(zeroCreated?.reconciliation).toEqual(creating?.reconciliation);
    expect(await database.select().from(company)).toHaveLength(30);
    expect(await database.select().from(userAccount)).toHaveLength(61);
    expect(await database.select().from(companyRoleAssignment)).toHaveLength(60);
    expect(await database.select().from(vendor)).toHaveLength(1);
    expect(await database.select().from(vendorAccount)).toHaveLength(1);
    expect(await database.select().from(licenseType)).toHaveLength(1);
    expect(await database.select().from(licenseRequest)).toHaveLength(2);
    expect(await database.select().from(requestTransition)).toHaveLength(2);
    expect(await database.select().from(licenseAssignment)).toHaveLength(2);
    expect(await database.select().from(vendorAccountCapacity)).toHaveLength(1);
    expect(await database.select().from(person)).toHaveLength(2);
    expect(await database.select().from(integrationCredential)).toHaveLength(2);
    const audits = await database.select().from(auditLog);
    const assignmentAudits = audits.filter(
      (row) => row.action === "license_assignment.imported",
    );
    expect(assignmentAudits).toHaveLength(2);
    expect(new Set(assignmentAudits.map((row) => row.entityId)).size).toBe(2);
    expect(audits.filter((row) => row.action === "go_live_import.completed"))
      .toHaveLength(2);
    expect(audits).toHaveLength(4);
  });
});
