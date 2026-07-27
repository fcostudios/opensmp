// Fixture-scoped state and credential verification for the US-007 operator.
import {
  createHash,
  timingSafeEqual,
} from "node:crypto";

import { and, eq, inArray, isNull } from "drizzle-orm";

import {
  parseCapacityCsv,
  parseCompaniesCsv,
  parseMemberBackfillCsv,
} from "@smp/contracts";
// eslint-disable-next-line no-restricted-imports -- Fixture verification is a read-only transaction service.
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
  reconcileGoLiveImport,
  type GoLiveCsvInput,
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

export interface FixtureVerificationInput {
  readonly csvInput: GoLiveCsvInput;
  readonly actorUserId: string;
  readonly privateRoot: string;
  readonly kekFile: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
}

function assertOperatorCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
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
  const reconciliation = await reconcileGoLiveImport(
    database,
    expectedMembers,
    expectedCapacities,
    new Map(accounts.map((row) => [row.vendorOrgRef, row])),
    new Map(teamsTypes.map((row) => [row.name, row])),
  );
  assertOperatorCondition(
    reconciliation.every(
      (line) => line.memberDelta === 0 && line.capacityDelta === 0,
    ),
    "Fixture reconciliation is invalid",
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
      let plaintext: string;
      try {
        plaintext = await decryptCredential(envelope, kek);
      } catch {
        throw new Error("Fixture credential authentication failed");
      }
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
  const expectedGrantKeys = new Set(
    expectedGrantTuples.map((tuple) => {
      const account = contactAccountByEmail.get(tuple.email);
      assertOperatorCondition(account, "Fixture contact account is missing");
      return `${account.id}\u0000${tuple.companyId}\u0000${tuple.role}`;
    }),
  );
  const actualGrantKeys = grants.map(
    (row) => `${row.userAccountId}\u0000${row.companyId}\u0000${row.role}`,
  );
  assertOperatorCondition(
    grants.length === expectedGrantTuples.length &&
      actualGrantKeys.every((key) => expectedGrantKeys.has(key)),
    "Fixture contact grant mapping is invalid",
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
  };
}
