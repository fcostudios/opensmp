import { randomBytes } from "node:crypto";
import { access, chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import {
  parseCapacityCsv,
  parseCompaniesCsv,
  parseMemberBackfillCsv,
} from "@smp/contracts";
import * as schema from "@smp/db/schema";
import {
  auditLog,
  company,
  companyRoleAssignment,
  integrationCredential,
  licenseAssignment,
  licenseRequest,
  licenseType,
  person,
  userAccount,
  vendor,
  vendorAccount,
  vendorAccountCapacity,
} from "@smp/db/schema";
import { parseCredentialEnvelope } from "@smp/domain";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const FIXTURE_ROOT = resolve(REPO_ROOT, "data/imports/fixtures/us007");
const PRIVATE_ROOT = resolve(REPO_ROOT, "data/imports/private");
const RUNTIME_ENV_FILE = resolve(PRIVATE_ROOT, "us007.runtime.env");
const KEK_FILE = resolve(PRIVATE_ROOT, "us007.integration-credential.kek");
const MANIFEST_FILE = resolve(FIXTURE_ROOT, "credential-manifest.json");
const ROOT_ENV_FILE = resolve(REPO_ROOT, ".env");

const ACTOR_ID = "70070000-0000-4000-8000-000000000007";
const ACTOR_EMAIL = "us007.group-admin@ledger.invalid";
const FIXTURE_ORG_REFS = ["corporativo-teams", "centrohub-teams"] as const;
const CREDENTIAL_ENV_NAMES = [
  "ANTHROPIC_CORPORATIVO_TEAMS_ADMIN_KEY",
  "ANTHROPIC_CORPORATIVO_TEAMS_ANALYTICS_KEY",
  "ANTHROPIC_CENTROHUB_TEAMS_ADMIN_KEY",
  "ANTHROPIC_CENTROHUB_TEAMS_ANALYTICS_KEY",
] as const;

type Mode = "init" | "preview" | "apply" | "verify";
type Database = ReturnType<typeof drizzle<typeof schema>>;

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function parseMode(value: string | undefined): Mode {
  if (value === "init" || value === "preview" || value === "apply" || value === "verify") {
    return value;
  }
  throw new Error("Usage: pnpm --filter smp-web import:go-live <init|preview|apply|verify>");
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function createDistinctCredentialValues(): string[] {
  const values = new Set<string>();
  while (values.size < CREDENTIAL_ENV_NAMES.length) {
    values.add(`synthetic-local-${randomBytes(24).toString("base64url")}`);
  }
  return [...values];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function initializePrivateMaterial(): Promise<void> {
  await mkdir(PRIVATE_ROOT, { recursive: true, mode: 0o700 });
  await chmod(PRIVATE_ROOT, 0o700);
  assertCondition(
    !(await pathExists(RUNTIME_ENV_FILE)),
    `Refusing to overwrite existing file: ${RUNTIME_ENV_FILE}`,
  );
  assertCondition(
    !(await pathExists(KEK_FILE)),
    `Refusing to overwrite existing file: ${KEK_FILE}`,
  );

  const credentialValues = createDistinctCredentialValues();
  const runtimeEnvironment = [
    `LEDGER_CREDENTIAL_MANIFEST_FILE=${MANIFEST_FILE}`,
    `LEDGER_CREDENTIAL_KEK_FILE=${KEK_FILE}`,
    ...CREDENTIAL_ENV_NAMES.map(
      (name, index) => `${name}=${credentialValues[index]}`,
    ),
    "",
  ].join("\n");
  const kek = `${randomBytes(32).toString("base64")}\n`;
  let wroteKek = false;
  let wroteRuntimeEnvironment = false;

  try {
    await writeFile(KEK_FILE, kek, { flag: "wx", mode: 0o400 });
    wroteKek = true;
    await writeFile(RUNTIME_ENV_FILE, runtimeEnvironment, {
      flag: "wx",
      mode: 0o600,
    });
    wroteRuntimeEnvironment = true;
  } catch {
    if (wroteRuntimeEnvironment) {
      await unlink(RUNTIME_ENV_FILE).catch(() => undefined);
    }
    if (wroteKek) {
      await unlink(KEK_FILE).catch(() => undefined);
    }
    throw new Error(`Unable to create private import files under: ${PRIVATE_ROOT}`);
  }

  process.stdout.write(`${RUNTIME_ENV_FILE}\n${KEK_FILE}\n`);
}

async function loadRuntimeEnvironment(): Promise<void> {
  if (!(await pathExists(RUNTIME_ENV_FILE))) {
    throw new Error(`Runtime environment file is required: ${RUNTIME_ENV_FILE}`);
  }
  loadDotenv({ path: ROOT_ENV_FILE });
  const runtimeEnvironment = loadDotenv({
    path: RUNTIME_ENV_FILE,
    override: true,
  });
  if (runtimeEnvironment.error) {
    throw new Error(`Unable to load runtime environment file: ${RUNTIME_ENV_FILE}`);
  }
  assertCondition(process.env.DATABASE_URL?.trim(), "DATABASE_URL is required");
}

async function readFixtureInput() {
  const [companiesCsv, membersCsv, capacityCsv] = await Promise.all([
    readFile(resolve(FIXTURE_ROOT, "companies.csv"), "utf8"),
    readFile(resolve(FIXTURE_ROOT, "member-backfill.csv"), "utf8"),
    readFile(resolve(FIXTURE_ROOT, "capacity.csv"), "utf8"),
  ]);
  return { companiesCsv, membersCsv, capacityCsv };
}

async function loadPreparedInput() {
  const boundary = await import(
    "../src/modules/org-registry/register-backfill-transaction"
  );
  const csvInput = await readFixtureInput();
  const prepared = await boundary.prepareProductionGoLiveImport({
    ...csvInput,
    actorUserId: ACTOR_ID,
  }, process.env, { allowedKekRoot: PRIVATE_ROOT });
  return { boundary, prepared };
}

async function preview(database: Database): Promise<void> {
  const { boundary, prepared } = await loadPreparedInput();
  const report = await boundary.dryRunGoLiveImport(
    database,
    prepared,
    prepared.credentials,
    prepared.kek,
  );
  printJson({
    inserts: report.inserts,
    existing: report.existing,
    errors: report.errors,
  });
  assertCondition(report.errors.length === 0, "Preview validation failed");
}

async function ensureActor(database: Database): Promise<void> {
  const matches = await database
    .select()
    .from(userAccount)
    .where(or(eq(userAccount.id, ACTOR_ID), eq(userAccount.email, ACTOR_EMAIL)));
  if (matches.length === 0) {
    await database.insert(userAccount).values({
      id: ACTOR_ID,
      email: ACTOR_EMAIL,
      globalRole: "group_admin",
      status: "active",
      createdAt: new Date(),
    });
    return;
  }
  assertCondition(
    matches.length === 1 &&
      matches[0]?.id === ACTOR_ID &&
      matches[0].email === ACTOR_EMAIL &&
      matches[0].globalRole === "group_admin" &&
      matches[0].status === "active",
    "Deterministic import actor conflicts with an existing account",
  );
}

async function applyImport(database: Database): Promise<void> {
  const { boundary, prepared } = await loadPreparedInput();
  const report = await boundary.dryRunGoLiveImport(
    database,
    prepared,
    prepared.credentials,
    prepared.kek,
  );
  assertCondition(report.errors.length === 0, "Apply refused because preview validation failed");
  await ensureActor(database);
  const result = await boundary.auditedGoLiveImportBoundary.run(database, prepared);
  printJson({ created: result.created, reconciliation: result.reconciliation });
}

async function verifyImport(database: Database): Promise<void> {
  const fixtureInput = await readFixtureInput();
  const expectedCompanies = parseCompaniesCsv(fixtureInput.companiesCsv);
  const expectedMembers = parseMemberBackfillCsv(fixtureInput.membersCsv);
  const expectedCapacities = parseCapacityCsv(fixtureInput.capacityCsv);
  assertCondition(expectedCompanies.length === 6, "Fixture company inventory is invalid");
  assertCondition(expectedMembers.length === 12, "Fixture member inventory is invalid");
  assertCondition(expectedCapacities.length === 2, "Fixture capacity inventory is invalid");

  const expectedCompanyByCode = new Map(
    expectedCompanies.map((row) => [row.code, row]),
  );
  const fixtureCodes = expectedCompanies.map((row) => row.code);
  const companies = await database
    .select()
    .from(company)
    .where(inArray(company.code, fixtureCodes));
  assertCondition(
    companies.length === expectedCompanies.length,
    "Fixture company count is invalid",
  );
  for (const row of companies) {
    assertCondition(
      expectedCompanyByCode.get(row.code)?.name === row.name,
      "Fixture company code/name mapping is invalid",
    );
  }
  const companyIdByCode = new Map(companies.map((row) => [row.code, row.id]));

  const anthropicVendors = await database
    .select()
    .from(vendor)
    .where(eq(vendor.name, "Anthropic"));
  const anthropicVendorIds = anthropicVendors.map((row) => row.id);
  assertCondition(anthropicVendorIds.length > 0, "Anthropic vendor is missing");
  const accounts = await database
    .select()
    .from(vendorAccount)
    .where(
      and(
        inArray(vendorAccount.vendorId, anthropicVendorIds),
        inArray(vendorAccount.vendorOrgRef, [...FIXTURE_ORG_REFS]),
      ),
    );
  assertCondition(accounts.length === 2, "Fixture vendor account count is invalid");
  assertCondition(
    new Set(accounts.map((row) => row.vendorOrgRef)).size === 2 &&
      accounts.every((row) => FIXTURE_ORG_REFS.includes(
        row.vendorOrgRef as (typeof FIXTURE_ORG_REFS)[number],
      )),
    "Fixture vendor account mapping is invalid",
  );
  const accountIds = accounts.map((row) => row.id);
  const accountRefById = new Map(accounts.map((row) => [row.id, row.vendorOrgRef]));

  const teamsTypes = await database
    .select()
    .from(licenseType)
    .where(
      and(
        inArray(licenseType.vendorId, anthropicVendorIds),
        eq(licenseType.name, "Teams"),
      ),
    );
  assertCondition(teamsTypes.length === 1, "Fixture Teams license type count is invalid");
  const teamsType = teamsTypes[0];

  const expectedMemberByEmail = new Map(
    expectedMembers.map((row) => [row.email, row]),
  );
  const people = await database
    .select()
    .from(person)
    .where(inArray(person.email, expectedMembers.map((row) => row.email)));
  assertCondition(
    people.length === expectedMembers.length,
    "Fixture people count is invalid",
  );
  const personByEmail = new Map(people.map((row) => [row.email, row]));
  for (const savedPerson of people) {
    const expected = expectedMemberByEmail.get(savedPerson.email);
    assertCondition(expected, "Fixture person identity is invalid");
    assertCondition(
      savedPerson.fullName === expected.fullName &&
        savedPerson.companyId === companyIdByCode.get(expected.companyCode) &&
        savedPerson.status === "active",
      "Fixture person mapping is invalid",
    );
  }

  const assignments = await database
    .select()
    .from(licenseAssignment)
    .where(
      and(
        inArray(licenseAssignment.personId, people.map((row) => row.id)),
        eq(licenseAssignment.sourceKind, "import"),
        isNull(licenseAssignment.endedOn),
      ),
    );
  assertCondition(
    assignments.length === expectedMembers.length,
    "Fixture open imported assignment count is invalid",
  );
  const assignmentCounts = new Map<string, number>();
  for (const expected of expectedMembers) {
    const savedPerson = personByEmail.get(expected.email);
    assertCondition(savedPerson, "Fixture person is missing");
    const memberAssignments = assignments.filter(
      (row) => row.personId === savedPerson.id,
    );
    assertCondition(
      memberAssignments.length === 1,
      "Fixture member does not have exactly one open import assignment",
    );
    const assignment = memberAssignments[0];
    assertCondition(
      assignment.startedOn === expected.startedOn &&
        assignment.companyId === companyIdByCode.get(expected.companyCode) &&
        accountRefById.get(assignment.vendorAccountId) === expected.vendorOrgRef &&
        assignment.licenseTypeId === teamsType.id,
      "Fixture member assignment mapping is invalid",
    );
    assignmentCounts.set(
      expected.companyCode,
      (assignmentCounts.get(expected.companyCode) ?? 0) + 1,
    );
  }
  assertCondition(
    fixtureCodes.every((code) => assignmentCounts.get(code) === 2),
    "Fixture assignments are not evenly distributed by company",
  );

  const sourceRequestIds = assignments
    .map((row) => row.sourceRequestId)
    .filter((value): value is string => value !== null);
  assertCondition(sourceRequestIds.length === 12, "Fixture assignment request lineage is missing");
  const requests = await database
    .select()
    .from(licenseRequest)
    .where(inArray(licenseRequest.id, sourceRequestIds));
  assertCondition(
    requests.length === 12 &&
      requests.every((row) => {
        const assignment = assignments.find(
          (candidate) => candidate.sourceRequestId === row.id,
        );
        return Boolean(
          assignment &&
            row.state === "active" &&
            row.requestNo.startsWith("IMP-") &&
            row.personId === assignment.personId &&
            row.companyId === assignment.companyId &&
            row.vendorAccountId === assignment.vendorAccountId &&
            row.licenseTypeId === assignment.licenseTypeId &&
            row.licenseAssignmentId === assignment.id,
        );
      }),
    "Fixture active import request lineage is invalid",
  );

  const effectiveDates = [
    ...new Set(expectedCapacities.map((row) => row.effectiveFrom)),
  ];
  const capacities = await database
    .select()
    .from(vendorAccountCapacity)
    .where(
      and(
        inArray(vendorAccountCapacity.vendorAccountId, accountIds),
        eq(vendorAccountCapacity.licenseTypeId, teamsType.id),
        inArray(vendorAccountCapacity.effectiveFrom, effectiveDates),
      ),
    );
  assertCondition(
    capacities.length === expectedCapacities.length,
    "Fixture capacity rows are invalid",
  );
  const capacityByOrgRef = new Map<string, number>();
  for (const expected of expectedCapacities) {
    const matches = capacities.filter(
      (row) =>
        accountRefById.get(row.vendorAccountId) === expected.vendorOrgRef &&
        row.effectiveFrom === expected.effectiveFrom &&
        row.purchasedQty === expected.purchasedQty,
    );
    assertCondition(matches.length === 1, "Fixture capacity mapping is invalid");
    capacityByOrgRef.set(expected.vendorOrgRef, expected.purchasedQty);
  }

  const credentials = await database
    .select()
    .from(integrationCredential)
    .where(
      and(
        inArray(integrationCredential.vendorAccountId, accountIds),
        eq(integrationCredential.status, "active"),
      ),
    );
  assertCondition(credentials.length === 4, "Fixture active credential count is invalid");
  for (const account of accounts) {
    const kinds = credentials
      .filter((row) => row.vendorAccountId === account.id)
      .map((row) => row.kind)
      .sort();
    assertCondition(
      kinds.length === 2 &&
        kinds[0] === "admin_scoped" &&
        kinds[1] === "analytics",
      "Fixture credential kind mapping is invalid",
    );
  }
  for (const credential of credentials) {
    assertCondition(
      !credential.encryptedSecret.includes("synthetic-local-"),
      "Fixture credential encryption is invalid",
    );
    const envelope = parseCredentialEnvelope(credential.encryptedSecret);
    assertCondition(
      envelope.version === 1 &&
        envelope.algorithm === "xchacha20poly1305" &&
        envelope.ciphertext.length > 0 &&
        envelope.wrappedDek.length > 0 &&
        envelope.nonce.length > 0,
      "Fixture credential envelope is invalid",
    );
  }

  const expectedGrantTuples = expectedCompanies.flatMap((row) => [
    {
      email: row.approverEmail,
      companyId: companyIdByCode.get(row.code),
      role: "approver" as const,
    },
    {
      email: row.financeContactEmail,
      companyId: companyIdByCode.get(row.code),
      role: "finance" as const,
    },
  ]);
  assertCondition(
    expectedGrantTuples.every((tuple) => tuple.companyId),
    "Fixture contact company mapping is invalid",
  );
  const contactAccounts = await database
    .select()
    .from(userAccount)
    .where(inArray(
      userAccount.email,
      expectedGrantTuples.map((tuple) => tuple.email),
    ));
  assertCondition(
    contactAccounts.length === expectedGrantTuples.length,
    "Fixture contact account count is invalid",
  );
  const contactAccountByEmail = new Map(
    contactAccounts.map((row) => [row.email, row]),
  );
  const grants = await database
    .select()
    .from(companyRoleAssignment)
    .where(inArray(
      companyRoleAssignment.userAccountId,
      contactAccounts.map((row) => row.id),
    ));
  for (const expected of expectedGrantTuples) {
    const account = contactAccountByEmail.get(expected.email);
    assertCondition(account, "Fixture contact account is missing");
    assertCondition(
      grants.filter(
        (row) =>
          row.userAccountId === account.id &&
          row.companyId === expected.companyId &&
          row.role === expected.role,
      ).length === 1,
      "Fixture contact grant mapping is invalid",
    );
  }

  const assignmentIds = assignments.map((row) => row.id);
  const assignmentById = new Map(assignments.map((row) => [row.id, row]));
  const importedAudits = await database
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, "license_assignment.imported"),
        inArray(auditLog.entityId, assignmentIds),
      ),
    );
  assertCondition(
    assignments.every((assignment) =>
      importedAudits.some(
        (audit) =>
          audit.entityId === assignment.id &&
          audit.entityType === "LicenseAssignment" &&
          audit.companyId === assignment.companyId &&
          audit.note === "importación inicial",
      ),
    ) &&
      importedAudits.every((audit) => {
        const assignment = assignmentById.get(audit.entityId);
        return Boolean(
          assignment &&
            audit.entityType === "LicenseAssignment" &&
            audit.companyId === assignment.companyId &&
            audit.note === "importación inicial",
        );
      }),
    "Fixture license import audit count is invalid",
  );
  const completionAudits = await database
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.actorUserId, ACTOR_ID),
        eq(auditLog.action, "go_live_import.completed"),
      ),
    );
  assertCondition(
    completionAudits.length >= 1 &&
      completionAudits.every(
        (audit) =>
          audit.entityType === "UserAccount" &&
          audit.entityId === ACTOR_ID &&
          audit.note === "US-007 validated go-live import",
      ),
    "Fixture go-live completion audit is missing",
  );

  printJson({
    status: "ok",
    counts: {
      companies: companies.length,
      vendorAccounts: accounts.length,
      licenseTypes: teamsTypes.length,
      people: people.length,
      requests: requests.length,
      assignments: assignments.length,
      capacities: capacities.length,
      credentials: credentials.length,
      companyRoleAssignments: expectedGrantTuples.length,
      importedAudits: importedAudits.length,
      completionAudits: completionAudits.length,
    },
    mapping: {
      assignmentsByCompany: Object.fromEntries(
        fixtureCodes.map((code) => [code, assignmentCounts.get(code)]),
      ),
      capacityByVendorOrg: Object.fromEntries(capacityByOrgRef),
    },
  });
}

async function run(): Promise<void> {
  const mode = parseMode(process.argv[2]);
  if (mode === "init") {
    await initializePrivateMaterial();
    return;
  }

  await loadRuntimeEnvironment();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const database = drizzle(pool, { schema });
    if (mode === "preview") {
      await preview(database);
    } else if (mode === "apply") {
      await applyImport(database);
    } else {
      await verifyImport(database);
    }
  } finally {
    await pool.end();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown import error"}\n`);
  process.exitCode = 1;
});
