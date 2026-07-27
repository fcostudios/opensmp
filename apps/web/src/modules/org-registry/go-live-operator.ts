import {
  createHash,
  randomBytes as cryptoRandomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import {
  parseCapacityCsv,
  parseCompaniesCsv,
  parseMemberBackfillCsv,
} from "@smp/contracts";
// eslint-disable-next-line no-restricted-imports -- This is the local operator transaction service.
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

import {
  decryptCredential,
  readKekFile,
} from "@/modules/vendor-catalog/credential-crypto";
import type { ImportDatabase } from "./company-import-transaction";
import {
  auditedGoLiveImportBoundary,
  GO_LIVE_IMPORT_LOCK,
  type GoLiveCsvInput,
  type GoLiveImportInput,
} from "./register-backfill-transaction";

const FIXTURE_ORG_REFS = ["corporativo-teams", "centrohub-teams"] as const;
const CREDENTIAL_ENV_BY_ACCOUNT_KIND = new Map([
  [
    "corporativo-teams\u0000admin_scoped",
    "ANTHROPIC_CORPORATIVO_TEAMS_ADMIN_KEY",
  ],
  [
    "corporativo-teams\u0000analytics",
    "ANTHROPIC_CORPORATIVO_TEAMS_ANALYTICS_KEY",
  ],
  [
    "centrohub-teams\u0000admin_scoped",
    "ANTHROPIC_CENTROHUB_TEAMS_ADMIN_KEY",
  ],
  [
    "centrohub-teams\u0000analytics",
    "ANTHROPIC_CENTROHUB_TEAMS_ANALYTICS_KEY",
  ],
]);
const CREDENTIAL_ENV_NAMES = [...CREDENTIAL_ENV_BY_ACCOUNT_KIND.values()];

export const GO_LIVE_OPERATOR_ACTOR_BOOTSTRAP_ACTION =
  "go_live_operator.actor_bootstrapped";
export const GO_LIVE_OPERATOR_ACTOR_BOOTSTRAP_NOTE =
  "US-007 local operator actor bootstrap";

export interface OperatorPaths {
  readonly privateRoot: string;
  readonly runtimeEnvFile: string;
  readonly kekFile: string;
  readonly manifestFile: string;
}

export interface OperatorActor {
  readonly id: string;
  readonly email: string;
}

export interface FixtureVerificationInput {
  readonly csvInput: GoLiveCsvInput;
  readonly actorUserId: string;
  readonly privateRoot: string;
  readonly kekFile: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
}

type RandomBytes = (length: number) => Uint8Array;

export function assertOperatorCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertSafePrivateRoot(privateRoot: string): Promise<void> {
  const expected = resolve(privateRoot);
  try {
    const rootStat = await lstat(expected);
    const resolved = await realpath(expected);
    if (
      rootStat.isSymbolicLink() ||
      !rootStat.isDirectory() ||
      resolved !== expected
    ) {
      throw new Error("unsafe");
    }
  } catch {
    throw new Error(`Private import directory is unsafe: ${expected}`);
  }
}

async function targetExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw new Error(`Unable to inspect private import path: ${path}`);
  }
}

function createDistinctCredentialValues(randomBytes: RandomBytes): string[] {
  const values = new Set<string>();
  while (values.size < CREDENTIAL_ENV_NAMES.length) {
    values.add(
      `synthetic-local-${Buffer.from(randomBytes(24)).toString("base64url")}`,
    );
  }
  return [...values];
}

export async function initializePrivateMaterial(
  paths: OperatorPaths,
  randomBytes: RandomBytes = cryptoRandomBytes,
): Promise<{
  readonly runtimeEnvFile: string;
  readonly kekFile: string;
}> {
  const privateRoot = resolve(paths.privateRoot);
  const runtimeEnvFile = resolve(paths.runtimeEnvFile);
  const kekFile = resolve(paths.kekFile);
  assertOperatorCondition(
    dirname(runtimeEnvFile) === privateRoot && dirname(kekFile) === privateRoot,
    `Private import paths must be direct children of: ${privateRoot}`,
  );

  await mkdir(privateRoot, { recursive: true, mode: 0o700 });
  await assertSafePrivateRoot(privateRoot);
  await chmod(privateRoot, 0o700);
  assertOperatorCondition(
    !(await targetExists(runtimeEnvFile)),
    `Refusing to overwrite existing file: ${runtimeEnvFile}`,
  );
  assertOperatorCondition(
    !(await targetExists(kekFile)),
    `Refusing to overwrite existing file: ${kekFile}`,
  );

  const credentialValues = createDistinctCredentialValues(randomBytes);
  const runtimeEnvironment = [
    `LEDGER_CREDENTIAL_MANIFEST_FILE=${resolve(paths.manifestFile)}`,
    `LEDGER_CREDENTIAL_KEK_FILE=${kekFile}`,
    ...CREDENTIAL_ENV_NAMES.map(
      (name, index) => `${name}=${credentialValues[index]}`,
    ),
    "",
  ].join("\n");
  const kek = `${Buffer.from(randomBytes(32)).toString("base64")}\n`;
  let wroteKek = false;
  let wroteRuntimeEnvironment = false;

  try {
    await assertSafePrivateRoot(privateRoot);
    await writeFile(kekFile, kek, { flag: "wx", mode: 0o400 });
    wroteKek = true;
    await assertSafePrivateRoot(privateRoot);
    await writeFile(runtimeEnvFile, runtimeEnvironment, {
      flag: "wx",
      mode: 0o600,
    });
    wroteRuntimeEnvironment = true;
  } catch {
    const leftovers: string[] = [];
    if (wroteRuntimeEnvironment) {
      try {
        await unlink(runtimeEnvFile);
      } catch {
        leftovers.push(runtimeEnvFile);
      }
    }
    if (wroteKek) {
      try {
        await unlink(kekFile);
      } catch {
        leftovers.push(kekFile);
      }
    }
    if (leftovers.length > 0) {
      throw new Error(`Private import cleanup required: ${leftovers.join(", ")}`);
    }
    throw new Error(`Unable to create private import files under: ${privateRoot}`);
  }

  return { runtimeEnvFile, kekFile };
}

async function ensureOperatorActor(
  transaction: Parameters<Parameters<ImportDatabase["transaction"]>[0]>[0],
  actor: OperatorActor,
  occurredAt: Date,
): Promise<void> {
  const matches = await transaction
    .select()
    .from(userAccount)
    .where(or(eq(userAccount.id, actor.id), eq(userAccount.email, actor.email)));
  if (matches.length === 0) {
    await transaction.insert(userAccount).values({
      id: actor.id,
      email: actor.email,
      globalRole: "group_admin",
      status: "active",
      createdAt: occurredAt,
    });
    await transaction.insert(auditLog).values({
      actorUserId: null,
      action: GO_LIVE_OPERATOR_ACTOR_BOOTSTRAP_ACTION,
      entityType: "UserAccount",
      entityId: actor.id,
      companyId: null,
      note: GO_LIVE_OPERATOR_ACTOR_BOOTSTRAP_NOTE,
      before: null,
      after: {
        email: actor.email,
        global_role: "group_admin",
        status: "active",
      },
      occurredAt,
    });
    return;
  }
  assertOperatorCondition(
    matches.length === 1 &&
      matches[0]?.id === actor.id &&
      matches[0].email === actor.email &&
      matches[0].globalRole === "group_admin" &&
      matches[0].status === "active",
    "Deterministic import actor conflicts with an existing account",
  );
}

export async function runLockedGoLiveOperatorImport(
  database: ImportDatabase,
  input: GoLiveImportInput,
  actor: OperatorActor,
) {
  assertOperatorCondition(
    input.actorUserId === actor.id,
    "Operator actor does not match the prepared import",
  );
  const occurredAt = input.occurredAt ?? new Date();
  return database.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${GO_LIVE_IMPORT_LOCK}, 0))`,
    );
    await ensureOperatorActor(transaction, actor, occurredAt);
    return auditedGoLiveImportBoundary.run(
      transaction as unknown as ImportDatabase,
      input,
    );
  });
}

function secretsMatch(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export async function verifyGoLiveFixture(
  database: ImportDatabase,
  input: FixtureVerificationInput,
) {
  const expectedCompanies = parseCompaniesCsv(input.csvInput.companiesCsv);
  const expectedMembers = parseMemberBackfillCsv(input.csvInput.membersCsv);
  const expectedCapacities = parseCapacityCsv(input.csvInput.capacityCsv);
  assertOperatorCondition(
    expectedCompanies.length === 6,
    "Fixture company inventory is invalid",
  );
  assertOperatorCondition(
    expectedMembers.length === 12,
    "Fixture member inventory is invalid",
  );
  assertOperatorCondition(
    expectedCapacities.length === 2,
    "Fixture capacity inventory is invalid",
  );

  const expectedCompanyByCode = new Map(
    expectedCompanies.map((row) => [row.code, row]),
  );
  const fixtureCodes = expectedCompanies.map((row) => row.code);
  const companies = await database
    .select()
    .from(company)
    .where(inArray(company.code, fixtureCodes));
  assertOperatorCondition(
    companies.length === expectedCompanies.length,
    "Fixture company count is invalid",
  );
  for (const row of companies) {
    assertOperatorCondition(
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
  assertOperatorCondition(
    anthropicVendorIds.length > 0,
    "Anthropic vendor is missing",
  );
  const accounts = await database
    .select()
    .from(vendorAccount)
    .where(
      and(
        inArray(vendorAccount.vendorId, anthropicVendorIds),
        inArray(vendorAccount.vendorOrgRef, [...FIXTURE_ORG_REFS]),
      ),
    );
  assertOperatorCondition(
    accounts.length === 2,
    "Fixture vendor account count is invalid",
  );
  assertOperatorCondition(
    new Set(accounts.map((row) => row.vendorOrgRef)).size === 2 &&
      accounts.every((row) =>
        FIXTURE_ORG_REFS.includes(
          row.vendorOrgRef as (typeof FIXTURE_ORG_REFS)[number],
        )),
    "Fixture vendor account mapping is invalid",
  );
  const accountIds = accounts.map((row) => row.id);
  const accountRefById = new Map(
    accounts.map((row) => [row.id, row.vendorOrgRef]),
  );

  const teamsTypes = await database
    .select()
    .from(licenseType)
    .where(
      and(
        inArray(licenseType.vendorId, anthropicVendorIds),
        eq(licenseType.name, "Teams"),
      ),
    );
  assertOperatorCondition(
    teamsTypes.length === 1,
    "Fixture Teams license type count is invalid",
  );
  const teamsType = teamsTypes[0];

  const expectedMemberByEmail = new Map(
    expectedMembers.map((row) => [row.email, row]),
  );
  const people = await database
    .select()
    .from(person)
    .where(inArray(person.email, expectedMembers.map((row) => row.email)));
  assertOperatorCondition(
    people.length === expectedMembers.length,
    "Fixture people count is invalid",
  );
  const personByEmail = new Map(people.map((row) => [row.email, row]));
  for (const savedPerson of people) {
    const expected = expectedMemberByEmail.get(savedPerson.email);
    assertOperatorCondition(expected, "Fixture person identity is invalid");
    assertOperatorCondition(
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
  assertOperatorCondition(
    assignments.length === expectedMembers.length,
    "Fixture open imported assignment count is invalid",
  );
  const assignmentCounts = new Map<string, number>();
  for (const expected of expectedMembers) {
    const savedPerson = personByEmail.get(expected.email);
    assertOperatorCondition(savedPerson, "Fixture person is missing");
    const memberAssignments = assignments.filter(
      (row) => row.personId === savedPerson.id,
    );
    assertOperatorCondition(
      memberAssignments.length === 1,
      "Fixture member does not have exactly one open import assignment",
    );
    const assignment = memberAssignments[0];
    assertOperatorCondition(
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
  assertOperatorCondition(
    fixtureCodes.every((code) => assignmentCounts.get(code) === 2),
    "Fixture assignments are not evenly distributed by company",
  );

  const sourceRequestIds = assignments
    .map((row) => row.sourceRequestId)
    .filter((value): value is string => value !== null);
  assertOperatorCondition(
    sourceRequestIds.length === 12,
    "Fixture assignment request lineage is missing",
  );
  const requests = await database
    .select()
    .from(licenseRequest)
    .where(inArray(licenseRequest.id, sourceRequestIds));
  assertOperatorCondition(
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
  assertOperatorCondition(
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
    assertOperatorCondition(
      matches.length === 1,
      "Fixture capacity mapping is invalid",
    );
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
  assertOperatorCondition(
    credentials.length === 4,
    "Fixture active credential count is invalid",
  );
  const kek = await readKekFile(input.kekFile, {
    allowedRoot: input.privateRoot,
  });
  for (const account of accounts) {
    const accountCredentials = credentials.filter(
      (row) => row.vendorAccountId === account.id,
    );
    const kinds = accountCredentials.map((row) => row.kind).sort();
    assertOperatorCondition(
      kinds.length === 2 &&
        kinds[0] === "admin_scoped" &&
        kinds[1] === "analytics",
      "Fixture credential kind mapping is invalid",
    );
    for (const credential of accountCredentials) {
      assertOperatorCondition(
        !credential.encryptedSecret.includes("synthetic-local-"),
        "Fixture credential encryption is invalid",
      );
      const envelope = parseCredentialEnvelope(credential.encryptedSecret);
      const environmentName = CREDENTIAL_ENV_BY_ACCOUNT_KIND.get(
        `${account.vendorOrgRef}\u0000${credential.kind}`,
      );
      const expected = environmentName
        ? input.environment[environmentName]?.trim()
        : undefined;
      assertOperatorCondition(
        environmentName && expected,
        "Fixture credential verification material is missing",
      );
      const plaintext = await decryptCredential(envelope, kek);
      assertOperatorCondition(
        secretsMatch(plaintext, expected),
        "Fixture credential authentication failed",
      );
    }
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
  assertOperatorCondition(
    expectedGrantTuples.every((tuple) => tuple.companyId),
    "Fixture contact company mapping is invalid",
  );
  const contactAccounts = await database
    .select()
    .from(userAccount)
    .where(
      inArray(
        userAccount.email,
        expectedGrantTuples.map((tuple) => tuple.email),
      ),
    );
  assertOperatorCondition(
    contactAccounts.length === expectedGrantTuples.length,
    "Fixture contact account count is invalid",
  );
  const contactAccountByEmail = new Map(
    contactAccounts.map((row) => [row.email, row]),
  );
  const grants = await database
    .select()
    .from(companyRoleAssignment)
    .where(
      inArray(
        companyRoleAssignment.userAccountId,
        contactAccounts.map((row) => row.id),
      ),
    );
  for (const expected of expectedGrantTuples) {
    const account = contactAccountByEmail.get(expected.email);
    assertOperatorCondition(account, "Fixture contact account is missing");
    assertOperatorCondition(
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
  assertOperatorCondition(
    assignments.every((assignment) =>
      importedAudits.some(
        (audit) =>
          audit.entityId === assignment.id &&
          audit.entityType === "LicenseAssignment" &&
          audit.companyId === assignment.companyId &&
          audit.note === "importación inicial",
      )) &&
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
        eq(auditLog.actorUserId, input.actorUserId),
        eq(auditLog.action, "go_live_import.completed"),
      ),
    );
  assertOperatorCondition(
    completionAudits.length >= 1 &&
      completionAudits.every(
        (audit) =>
          audit.entityType === "UserAccount" &&
          audit.entityId === input.actorUserId &&
          audit.note === "US-007 validated go-live import",
      ),
    "Fixture go-live completion audit is missing",
  );

  return {
    status: "ok" as const,
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
  };
}
