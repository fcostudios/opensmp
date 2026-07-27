import { randomBytes } from "node:crypto";
import { access, chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";
import { and, eq, inArray, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

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

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const FIXTURE_ROOT = resolve(REPO_ROOT, "data/imports/fixtures/us007");
const PRIVATE_ROOT = resolve(REPO_ROOT, "data/imports/private");
const RUNTIME_ENV_FILE = resolve(PRIVATE_ROOT, "us007.runtime.env");
const KEK_FILE = resolve(PRIVATE_ROOT, "us007.integration-credential.kek");
const MANIFEST_FILE = resolve(FIXTURE_ROOT, "credential-manifest.json");
const ROOT_ENV_FILE = resolve(REPO_ROOT, ".env");

const ACTOR_ID = "70070000-0000-4000-8000-000000000007";
const ACTOR_EMAIL = "us007.group-admin@ledger.invalid";
const FIXTURE_COMPANIES = new Map([
  ["CORP", "Corporativo"],
  ["PPM", "PPM"],
  ["FOCUS", "Focus"],
  ["MULLEN", "Mullen Lowe"],
  ["RAM", "RAM"],
  ["CENTROHUB", "CentroHub"],
]);
const CORPORATIVO_CODES = new Set(["CORP", "PPM", "FOCUS", "MULLEN", "RAM"]);
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
    await writeFile(KEK_FILE, kek, { flag: "wx", mode: 0o600 });
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
  });
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
  const fixtureCodes = [...FIXTURE_COMPANIES.keys()];
  const companies = await database
    .select()
    .from(company)
    .where(inArray(company.code, fixtureCodes));
  assertCondition(companies.length === 6, "Fixture company count is invalid");
  for (const row of companies) {
    assertCondition(
      FIXTURE_COMPANIES.get(row.code) === row.name,
      "Fixture company code/name mapping is invalid",
    );
  }
  const companyIds = companies.map((row) => row.id);
  const companyCodeById = new Map(companies.map((row) => [row.id, row.code]));

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

  const assignments = await database
    .select()
    .from(licenseAssignment)
    .where(
      and(
        inArray(licenseAssignment.companyId, companyIds),
        eq(licenseAssignment.sourceKind, "import"),
      ),
    );
  assertCondition(
    assignments.length === 12 && assignments.every((row) => row.endedOn === null),
    "Fixture open imported assignment count is invalid",
  );
  assertCondition(
    new Set(assignments.map((row) => row.personId)).size === 12,
    "Fixture imported assignments do not map to 12 distinct people",
  );
  const assignmentCounts = new Map<string, number>();
  for (const assignment of assignments) {
    const code = companyCodeById.get(assignment.companyId);
    const orgRef = accountRefById.get(assignment.vendorAccountId);
    assertCondition(code && orgRef, "Fixture assignment mapping is incomplete");
    const expectedOrgRef = CORPORATIVO_CODES.has(code)
      ? "corporativo-teams"
      : "centrohub-teams";
    assertCondition(orgRef === expectedOrgRef, "Fixture company/vendor mapping is invalid");
    assertCondition(
      assignment.licenseTypeId === teamsType.id,
      "Fixture assignment license type is invalid",
    );
    assignmentCounts.set(code, (assignmentCounts.get(code) ?? 0) + 1);
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
  const assignmentByRequestId = new Map(
    assignments.map((row) => [row.sourceRequestId, row.id]),
  );
  assertCondition(
    requests.length === 12 &&
      requests.every(
        (row) =>
          row.state === "active" &&
          row.requestNo.startsWith("IMP-") &&
          row.licenseAssignmentId === assignmentByRequestId.get(row.id),
      ),
    "Fixture active import request lineage is invalid",
  );
  const people = await database
    .select()
    .from(person)
    .where(inArray(person.id, assignments.map((row) => row.personId)));
  assertCondition(
    people.length === 12 && people.every((row) => row.status === "active"),
    "Fixture active people count is invalid",
  );

  const capacities = await database
    .select()
    .from(vendorAccountCapacity)
    .where(
      and(
        inArray(vendorAccountCapacity.vendorAccountId, accountIds),
        eq(vendorAccountCapacity.licenseTypeId, teamsType.id),
        eq(vendorAccountCapacity.effectiveFrom, "2026-07-01"),
      ),
    );
  const capacityByOrgRef = new Map(
    capacities.map((row) => [
      accountRefById.get(row.vendorAccountId),
      row.purchasedQty,
    ]),
  );
  assertCondition(
    capacities.length === 2 &&
      capacityByOrgRef.get("corporativo-teams") === 15 &&
      capacityByOrgRef.get("centrohub-teams") === 3,
    "Fixture capacity rows are invalid",
  );

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
  assertCondition(
    credentials.every((row) => !row.encryptedSecret.includes("synthetic-local-")),
    "Fixture credential encryption is invalid",
  );

  const grants = await database
    .select()
    .from(companyRoleAssignment)
    .where(inArray(companyRoleAssignment.companyId, companyIds));
  assertCondition(grants.length === 12, "Fixture company role assignment count is invalid");

  const importedAudits = await database
    .select()
    .from(auditLog)
    .where(
      and(
        inArray(auditLog.companyId, companyIds),
        eq(auditLog.action, "license_assignment.imported"),
      ),
    );
  assertCondition(
    importedAudits.length >= 12,
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
    completionAudits.length >= 1,
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
      companyRoleAssignments: grants.length,
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
