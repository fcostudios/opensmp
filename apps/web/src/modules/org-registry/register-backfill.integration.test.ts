import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
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
  parseCredentialEnvelope,
  serializeCredentialEnvelope,
} from "@smp/domain";

import {
  dryRunGoLiveImport,
  GO_LIVE_IMPORT_LOCK,
  runGoLiveImport,
} from "./register-backfill-transaction";
import {
  GO_LIVE_OPERATOR_ACTOR_BOOTSTRAP_ACTION,
  runLockedGoLiveOperatorImport,
} from "./go-live-operator-transaction";
import { verifyGoLiveFixture } from "./go-live-fixture-verification";

const actorId = "00000000-0000-4000-8000-000000000701";
const operatorActor = {
  id: "70070000-0000-4000-8000-000000000007",
  email: "us007.group-admin@ledger.invalid",
} as const;
const now = new Date("2026-08-01T12:00:00.000Z");
const baselineCompanyCount = 5;
const companiesCsvFor = (count: number) => [
  "code,name,type,approver_email,finance_contact_email,budget_monthly_usd,statement_language",
  ...Array.from({ length: count }, (_, index) => {
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
  }),
].join("\n");
const companiesCsv = companiesCsvFor(baselineCompanyCount);
const companyRows = companiesCsv.split("\n").slice(1);
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
const fixtureCredentialEnvironment = {
  ANTHROPIC_CORPORATIVO_TEAMS_ADMIN_KEY: "synthetic-corp-admin",
  ANTHROPIC_CORPORATIVO_TEAMS_ANALYTICS_KEY: "synthetic-corp-analytics",
  ANTHROPIC_CENTROHUB_TEAMS_ADMIN_KEY: "synthetic-centro-admin",
  ANTHROPIC_CENTROHUB_TEAMS_ANALYTICS_KEY: "synthetic-centro-analytics",
} as const;
const fixtureCredentialSeeds = [
  {
    vendorOrgRef: "corporativo-teams",
    kind: "admin_scoped" as const,
    plaintext: fixtureCredentialEnvironment.ANTHROPIC_CORPORATIVO_TEAMS_ADMIN_KEY,
    scopes: "read:members write:members",
  },
  {
    vendorOrgRef: "corporativo-teams",
    kind: "analytics" as const,
    plaintext: fixtureCredentialEnvironment.ANTHROPIC_CORPORATIVO_TEAMS_ANALYTICS_KEY,
  },
  {
    vendorOrgRef: "centrohub-teams",
    kind: "admin_scoped" as const,
    plaintext: fixtureCredentialEnvironment.ANTHROPIC_CENTROHUB_TEAMS_ADMIN_KEY,
    scopes: "read:members write:members",
  },
  {
    vendorOrgRef: "centrohub-teams",
    kind: "analytics" as const,
    plaintext: fixtureCredentialEnvironment.ANTHROPIC_CENTROHUB_TEAMS_ANALYTICS_KEY,
  },
];

async function readCommittedFixture() {
  const [companiesCsv, membersCsv, capacityCsv] = await Promise.all([
    readFile(new URL("../../../../../data/imports/fixtures/us007/companies.csv", import.meta.url), "utf8"),
    readFile(new URL("../../../../../data/imports/fixtures/us007/member-backfill.csv", import.meta.url), "utf8"),
    readFile(new URL("../../../../../data/imports/fixtures/us007/capacity.csv", import.meta.url), "utf8"),
  ]);
  return { companiesCsv, membersCsv, capacityCsv };
}

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
        companies: 5,
        contactAccounts: 10,
        roleAssignments: 10,
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
    expect(await database.select().from(userAccount)).toHaveLength(11);
    expect((await database.select().from(userAccount)).filter(
      (row) => ["approver1@example.invalid", "finance1@example.invalid"].includes(row.email),
    ))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ email: "approver1@example.invalid", status: "disabled" }),
        expect.objectContaining({ email: "finance1@example.invalid", status: "disabled" }),
      ]));
    expect((await database.select().from(companyRoleAssignment)).map((row) => row.role).sort())
      .toHaveLength(10);
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

  it("rolls back the operator actor and bootstrap audit when import encryption fails", async () => {
    await expect(runLockedGoLiveOperatorImport(
      database,
      {
        actorUserId: operatorActor.id,
        companiesCsv,
        membersCsv,
        capacityCsv,
        occurredAt: now,
        credentials: credentialSeeds,
        kek: new Uint8Array(31),
        randomBytes: deterministicBytes,
      },
      operatorActor,
    )).rejects.toThrow("Credential KEK must contain exactly 32 bytes");

    expect(await database
      .select()
      .from(userAccount)
      .where(eq(userAccount.id, operatorActor.id))).toEqual([]);
    expect(await database
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, GO_LIVE_OPERATOR_ACTOR_BOOTSTRAP_ACTION)))
      .toEqual([]);
  });

  it("bootstraps and audits the local operator actor exactly once", async () => {
    const input = {
      actorUserId: operatorActor.id,
      companiesCsv,
      membersCsv,
      capacityCsv,
      occurredAt: now,
      credentials: credentialSeeds,
      kek: testKek,
      randomBytes: deterministicBytes,
    };

    await runLockedGoLiveOperatorImport(database, input, operatorActor);
    await runLockedGoLiveOperatorImport(database, input, operatorActor);

    expect(await database
      .select()
      .from(userAccount)
      .where(eq(userAccount.id, operatorActor.id)))
      .toEqual([
        expect.objectContaining({
          id: operatorActor.id,
          email: operatorActor.email,
          globalRole: "group_admin",
          status: "active",
        }),
      ]);
    expect(await database
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, GO_LIVE_OPERATOR_ACTOR_BOOTSTRAP_ACTION)))
      .toEqual([
        expect.objectContaining({
          actorUserId: null,
          entityType: "UserAccount",
          entityId: operatorActor.id,
          note: "US-007 local operator actor bootstrap",
        }),
      ]);
  });

  it("serializes concurrent operator bootstrap and import into one creation", async () => {
    const input = {
      actorUserId: operatorActor.id,
      companiesCsv,
      membersCsv,
      capacityCsv,
      occurredAt: now,
      credentials: credentialSeeds,
      kek: testKek,
      randomBytes: deterministicBytes,
    };

    const results = await Promise.all([
      runLockedGoLiveOperatorImport(database, input, operatorActor),
      runLockedGoLiveOperatorImport(database, input, operatorActor),
    ]);

    expect(results.map((result) => result.created.companies).sort()).toEqual([
      0,
      baselineCompanyCount,
    ]);
    expect(results.reduce(
      (sum, result) => sum + result.created.assignments,
      0,
    )).toBe(2);
    expect(await database
      .select()
      .from(userAccount)
      .where(eq(userAccount.id, operatorActor.id))).toHaveLength(1);
    expect(await database
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, GO_LIVE_OPERATOR_ACTOR_BOOTSTRAP_ACTION)))
      .toHaveLength(1);
    expect(await database.select().from(company)).toHaveLength(baselineCompanyCount);
    expect(await database.select().from(licenseAssignment)).toHaveLength(2);
  });

  it("rejects a committed fixture whose production reconciliation has a nonzero member delta", async () => {
    const csvInput = await readCommittedFixture();
    const privateRoot = await mkdtemp(join(tmpdir(), "ledger-verify-"));
    const kekFile = join(privateRoot, "kek");
    await writeFile(
      kekFile,
      `${Buffer.from(testKek).toString("base64")}\n`,
      { mode: 0o400 },
    );
    await chmod(kekFile, 0o400);
    try {
      await runLockedGoLiveOperatorImport(database, {
        ...csvInput,
        actorUserId: operatorActor.id,
        occurredAt: now,
        credentials: fixtureCredentialSeeds,
        kek: testKek,
        randomBytes: deterministicBytes,
      }, operatorActor);
      const verificationInput = {
        csvInput,
        actorUserId: operatorActor.id,
        privateRoot,
        kekFile,
        environment: fixtureCredentialEnvironment,
      };

      expect(await verifyGoLiveFixture(database, verificationInput)).toEqual({
        status: "ok",
        counts: {
          companies: 6,
          vendorAccounts: 2,
          licenseTypes: 1,
          people: 12,
          requests: 12,
          assignments: 12,
          capacities: 2,
          credentials: 4,
          companyRoleAssignments: 12,
          importedAudits: 12,
          completionAudits: 1,
        },
        mapping: {
          assignmentsByCompany: {
            CORP: 2,
            PPM: 2,
            FOCUS: 2,
            MULLEN: 2,
            RAM: 2,
            CENTROHUB: 2,
          },
          capacityByVendorOrg: {
            "corporativo-teams": 15,
            "centrohub-teams": 3,
          },
        },
      });

      const [corp] = await database
        .select()
        .from(company)
        .where(eq(company.code, "CORP"));
      const [account] = await database
        .select()
        .from(vendorAccount)
        .where(eq(vendorAccount.vendorOrgRef, "corporativo-teams"));
      const [teams] = await database
        .select()
        .from(licenseType)
        .where(eq(licenseType.name, "Teams"));
      const [unrelatedPerson] = await database.insert(person).values({
        email: "unrelated.fixture@ledger.invalid",
        fullName: "Unrelated Fixture",
        companyId: corp.id,
        status: "active",
        createdAt: now,
        createdBy: operatorActor.id,
      }).returning();
      const [unrelatedRequest] = await database.insert(licenseRequest).values({
        requestNo: "IMP-UNRELATED-FIXTURE",
        personId: unrelatedPerson.id,
        companyId: corp.id,
        vendorAccountId: account.id,
        licenseTypeId: teams.id,
        state: "active",
        justification: "unrelated",
        createdAt: now,
      }).returning();
      const [unrelatedAssignment] = await database.insert(licenseAssignment).values({
        personId: unrelatedPerson.id,
        companyId: corp.id,
        vendorAccountId: account.id,
        licenseTypeId: teams.id,
        startedOn: "2026-07-01",
        sourceRequestId: unrelatedRequest.id,
        sourceKind: "import",
        createdAt: now,
      }).returning();
      await database
        .update(licenseRequest)
        .set({ licenseAssignmentId: unrelatedAssignment.id })
        .where(eq(licenseRequest.id, unrelatedRequest.id));
      const [unrelatedAccount] = await database.insert(userAccount).values({
        email: "unrelated.grant@ledger.invalid",
        status: "disabled",
        createdAt: now,
        createdBy: operatorActor.id,
      }).returning();
      await database.insert(companyRoleAssignment).values({
        userAccountId: unrelatedAccount.id,
        companyId: corp.id,
        role: "viewer",
        uniqueGrant: `${unrelatedAccount.id}:${corp.id}:viewer`,
        createdAt: now,
        createdBy: operatorActor.id,
      });
      await database.insert(auditLog).values({
        actorUserId: null,
        action: "license_assignment.imported",
        entityType: "LicenseAssignment",
        entityId: unrelatedAssignment.id,
        companyId: corp.id,
        note: "unrelated",
        occurredAt: now,
      });

      await expect(
        verifyGoLiveFixture(database, verificationInput),
      ).rejects.toThrow("Fixture reconciliation is invalid");
    } finally {
      await rm(privateRoot, { recursive: true, force: true });
    }
  });

  it("rejects an unexpected company grant for a fixture contact", async () => {
    const csvInput = await readCommittedFixture();
    const privateRoot = await mkdtemp(join(tmpdir(), "ledger-verify-grant-"));
    const kekFile = join(privateRoot, "kek");
    await writeFile(
      kekFile,
      `${Buffer.from(testKek).toString("base64")}\n`,
      { mode: 0o400 },
    );
    await chmod(kekFile, 0o400);
    try {
      await runLockedGoLiveOperatorImport(database, {
        ...csvInput,
        actorUserId: operatorActor.id,
        occurredAt: now,
        credentials: fixtureCredentialSeeds,
        kek: testKek,
        randomBytes: deterministicBytes,
      }, operatorActor);
      const [corp] = await database
        .select()
        .from(company)
        .where(eq(company.code, "CORP"));
      const [approver] = await database
        .select()
        .from(userAccount)
        .where(eq(userAccount.email, "approver.corp@ledger.invalid"));
      await database.insert(companyRoleAssignment).values({
        userAccountId: approver.id,
        companyId: corp.id,
        role: "finance",
        uniqueGrant: `${approver.id}:${corp.id}:finance`,
        createdAt: now,
        createdBy: operatorActor.id,
      });

      await expect(verifyGoLiveFixture(database, {
        csvInput,
        actorUserId: operatorActor.id,
        privateRoot,
        kekFile,
        environment: fixtureCredentialEnvironment,
      })).rejects.toThrow("Fixture contact grant mapping is invalid");
    } finally {
      await rm(privateRoot, { recursive: true, force: true });
    }
  });

  it("rejects a committed fixture whose production reconciliation has a nonzero capacity delta", async () => {
    const csvInput = await readCommittedFixture();
    const privateRoot = await mkdtemp(join(tmpdir(), "ledger-verify-capacity-"));
    const kekFile = join(privateRoot, "kek");
    await writeFile(
      kekFile,
      `${Buffer.from(testKek).toString("base64")}\n`,
      { mode: 0o400 },
    );
    await chmod(kekFile, 0o400);
    try {
      await runLockedGoLiveOperatorImport(database, {
        ...csvInput,
        actorUserId: operatorActor.id,
        occurredAt: now,
        credentials: fixtureCredentialSeeds,
        kek: testKek,
        randomBytes: deterministicBytes,
      }, operatorActor);
      const [account] = await database
        .select()
        .from(vendorAccount)
        .where(eq(vendorAccount.vendorOrgRef, "corporativo-teams"));
      await ownerDatabase
        .update(vendorAccountCapacity)
        .set({ purchasedQty: 14 })
        .where(eq(vendorAccountCapacity.vendorAccountId, account.id));

      await expect(verifyGoLiveFixture(database, {
        csvInput,
        actorUserId: operatorActor.id,
        privateRoot,
        kekFile,
        environment: fixtureCredentialEnvironment,
      })).rejects.toThrow("Fixture reconciliation is invalid");
    } finally {
      await rm(privateRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      inventory: "company",
      field: "companiesCsv" as const,
      message: "Fixture company inventory is invalid",
    },
    {
      inventory: "member",
      field: "membersCsv" as const,
      message: "Fixture member inventory is invalid",
    },
    {
      inventory: "capacity",
      field: "capacityCsv" as const,
      message: "Fixture capacity inventory is invalid",
    },
  ])("rejects an invalid committed $inventory inventory cardinality", async ({
    field,
    message,
  }) => {
    const csvInput = await readCommittedFixture();
    const invalidCsv = csvInput[field].trimEnd().split("\n").slice(0, -1).join("\n");

    await expect(verifyGoLiveFixture(database, {
      csvInput: { ...csvInput, [field]: invalidCsv },
      actorUserId: operatorActor.id,
      privateRoot: "/unused",
      kekFile: "/unused/kek",
      environment: {},
    })).rejects.toThrow(message);
  });

  it("rejects a mismatched expected fixture credential without disclosing it", async () => {
    const csvInput = await readCommittedFixture();
    const privateRoot = await mkdtemp(join(tmpdir(), "ledger-verify-mismatch-"));
    const kekFile = join(privateRoot, "kek");
    await writeFile(
      kekFile,
      `${Buffer.from(testKek).toString("base64")}\n`,
      { mode: 0o400 },
    );
    await chmod(kekFile, 0o400);
    try {
      await runLockedGoLiveOperatorImport(database, {
        ...csvInput,
        actorUserId: operatorActor.id,
        occurredAt: now,
        credentials: fixtureCredentialSeeds,
        kek: testKek,
        randomBytes: deterministicBytes,
      }, operatorActor);
      const mismatched = "synthetic-mismatched-secret";
      const error = await verifyGoLiveFixture(database, {
        csvInput,
        actorUserId: operatorActor.id,
        privateRoot,
        kekFile,
        environment: {
          ...fixtureCredentialEnvironment,
          ANTHROPIC_CORPORATIVO_TEAMS_ADMIN_KEY: mismatched,
        },
      }).then(
        () => undefined,
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "Fixture credential authentication failed",
      );
      expect((error as Error).message).not.toContain(mismatched);

      const [credential] = await database
        .select()
        .from(integrationCredential)
        .where(and(
          eq(integrationCredential.kind, "admin_scoped"),
          eq(integrationCredential.status, "active"),
        ))
        .limit(1);
      const envelope = parseCredentialEnvelope(credential.encryptedSecret);
      const finalCharacter = envelope.ciphertext.at(-1);
      await database
        .update(integrationCredential)
        .set({
          encryptedSecret: serializeCredentialEnvelope({
            ...envelope,
            ciphertext: `${envelope.ciphertext.slice(0, -1)}${finalCharacter === "A" ? "B" : "A"}`,
          }),
        })
        .where(eq(integrationCredential.id, credential.id));
      const tamperError = await verifyGoLiveFixture(database, {
        csvInput,
        actorUserId: operatorActor.id,
        privateRoot,
        kekFile,
        environment: fixtureCredentialEnvironment,
      }).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(tamperError).toBeInstanceOf(Error);
      expect((tamperError as Error).message).toBe(
        "Fixture credential authentication failed",
      );
    } finally {
      await rm(privateRoot, { recursive: true, force: true });
    }
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
        companies: 5,
        contactAccounts: 10,
        roleAssignments: 10,
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

  it.each([5, 6, 30])(
    "accepts a valid %i-company inventory through the same path",
    async (count) => {
      const report = await dryRunGoLiveImport(database, {
        companiesCsv: companiesCsvFor(count),
        membersCsv,
        capacityCsv,
      });
      expect(report.errors).toEqual([]);
      expect(report.inserts.companies).toBe(count);
      expect(report.inserts.contactAccounts).toBe(count * 2);
      expect(report.inserts.roleAssignments).toBe(count * 2);
      expect(await database.select().from(company)).toHaveLength(0);
    },
  );

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
    const creating = results.find(
      (result) => result.created.companies === baselineCompanyCount,
    );
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
      companies: 5,
      contactAccounts: 10,
      roleAssignments: 10,
      vendorAccounts: 1,
      licenseTypes: 1,
      capacities: 1,
      people: 2,
      requests: 2,
      assignments: 2,
      credentials: 2,
    });
    expect(zeroCreated?.reconciliation).toEqual(creating?.reconciliation);
    expect(await database.select().from(company)).toHaveLength(5);
    expect(await database.select().from(userAccount)).toHaveLength(11);
    expect(await database.select().from(companyRoleAssignment)).toHaveLength(10);
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
