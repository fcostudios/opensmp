import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import {
  parseCapacityCsv,
  parseCompaniesCsv,
  parseMemberBackfillCsv,
  type CapacityImportRow,
  type CompanyImportRow,
  type MemberBackfillRow,
} from "@smp/contracts";
import {
  auditLog,
  company,
  companyRoleAssignment,
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
import { db } from "@smp/db";

import { withAudit } from "@/modules/audit/with-audit";
import {
  importCompanies,
  type ImportDatabase,
} from "./company-import-transaction";
import {
  seedAnthropicCatalog,
  type CredentialSeed,
} from "@/modules/vendor-catalog/seeding-transaction";

export const productionImportDatabase = db as unknown as ImportDatabase;

export interface GoLiveCsvInput {
  readonly companiesCsv: string;
  readonly membersCsv: string;
  readonly capacityCsv: string;
}

interface ImportCounters {
  companies: number;
  contactAccounts: number;
  roleAssignments: number;
  vendorAccounts: number;
  licenseTypes: number;
  capacities: number;
  people: number;
  requests: number;
  assignments: number;
}

export interface DryRunReport {
  readonly inserts: ImportCounters;
  readonly existing: ImportCounters;
  readonly errors: string[];
}

export interface ReconciliationLine {
  readonly vendorOrgRef: string;
  readonly licenseType: string;
  readonly purchased: number;
  readonly consoleMembers: number;
  readonly importedAssignments: number;
  readonly delta: number;
}

export interface GoLiveImportInput extends GoLiveCsvInput {
  readonly actorUserId: string;
  readonly occurredAt?: Date;
  readonly credentials?: readonly CredentialSeed[];
  readonly kek?: Uint8Array;
  /** Test-only deterministic randomness injection. */
  readonly randomBytes?: (length: number) => Uint8Array;
}

const emptyCounters = (): ImportCounters => ({
  companies: 0,
  contactAccounts: 0,
  roleAssignments: 0,
  vendorAccounts: 0,
  licenseTypes: 0,
  capacities: 0,
  people: 0,
  requests: 0,
  assignments: 0,
});

function parseInput(input: GoLiveCsvInput) {
  return {
    companies: parseCompaniesCsv(input.companiesCsv),
    members: parseMemberBackfillCsv(input.membersCsv),
    capacities: parseCapacityCsv(input.capacityCsv),
  };
}

function requestNumber(row: MemberBackfillRow): string {
  const canonical = [
    row.vendorOrgRef,
    row.email,
    row.companyCode,
    row.licenseType,
    row.startedOn,
  ].join("\u0000");
  return `IMP-${createHash("sha256").update(canonical).digest("hex").slice(0, 24).toUpperCase()}`;
}

function capacityKey(row: CapacityImportRow): string {
  return `${row.vendorOrgRef}\u0000${row.licenseType}`;
}

function assertMemberReferences(
  companies: readonly CompanyImportRow[],
  members: readonly MemberBackfillRow[],
  capacities: readonly CapacityImportRow[],
  existingCompanyCodes: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  const companyCodes = new Set([
    ...existingCompanyCodes,
    ...companies.map((row) => row.code),
  ]);
  const catalogKeys = new Set(capacities.map(capacityKey));
  for (const member of members) {
    if (!companyCodes.has(member.companyCode)) {
      errors.push(
        `Member ${member.email} references unknown company ${member.companyCode}`,
      );
    }
    if (!catalogKeys.has(`${member.vendorOrgRef}\u0000${member.licenseType}`)) {
      errors.push(
        `Member ${member.email} references unknown vendor org/license type ${member.vendorOrgRef}/${member.licenseType}`,
      );
    }
  }
  return errors;
}

export async function dryRunGoLiveImport(
  database: ImportDatabase,
  input: GoLiveCsvInput,
): Promise<DryRunReport> {
  const parsed = parseInput(input);
  const inserts = emptyCounters();
  const existing = emptyCounters();
  const errors: string[] = [];
  // Keep reads sequential: this function also runs on a transaction-bound
  // node-postgres client, which must not execute overlapping queries.
  const savedCompanies = await database.select().from(company);
  const savedAccounts = await database.select().from(userAccount);
  const savedGrants = await database.select().from(companyRoleAssignment);
  const savedPeople = await database.select().from(person);
  const savedVendors = await database.select().from(vendor);
  const savedVendorAccounts = await database.select().from(vendorAccount);
  const savedLicenseTypes = await database.select().from(licenseType);
  const savedCapacities = await database.select().from(vendorAccountCapacity);
  const savedRequests = await database.select().from(licenseRequest);
  const savedAssignments = await database.select().from(licenseAssignment);

  const companyByCode = new Map(savedCompanies.map((row) => [row.code, row]));
  const accountByEmail = new Map(savedAccounts.map((row) => [row.email, row]));
  const personById = new Map(savedPeople.map((row) => [row.id, row]));
  const personByEmail = new Map(savedPeople.map((row) => [row.email, row]));
  const anthropic = savedVendors.find((row) => row.name === "Anthropic");
  const vendorAccounts = savedVendorAccounts.filter(
    (row) => anthropic && row.vendorId === anthropic.id,
  );
  const accountByRef = new Map(
    vendorAccounts.map((row) => [row.vendorOrgRef, row]),
  );
  const licenseByName = new Map(
    savedLicenseTypes
      .filter((row) => anthropic && row.vendorId === anthropic.id)
      .map((row) => [row.name, row]),
  );
  const requestByNumber = new Map(savedRequests.map((row) => [row.requestNo, row]));
  const assignmentRequestIds = new Set(
    savedAssignments.map((row) => row.sourceRequestId),
  );

  errors.push(...assertMemberReferences(
    parsed.companies,
    parsed.members,
    parsed.capacities,
    new Set(companyByCode.keys()),
  ));

  for (const row of parsed.companies) {
    const saved = companyByCode.get(row.code);
    if (saved) {
      existing.companies += 1;
      if (
        saved.name !== row.name ||
        saved.type !== row.type ||
        saved.financeContactEmail !== row.financeContactEmail ||
        saved.budgetMonthlyUsd !== row.budgetMonthlyUsd ||
        saved.statementLanguage !== row.statementLanguage
      ) {
        errors.push(`Company ${row.code} conflicts with its existing record`);
      }
    } else {
      inserts.companies += 1;
    }
    for (const [email, role] of [
      [row.approverEmail, "approver"],
      [row.financeContactEmail, "finance"],
    ] as const) {
      const savedAccount = accountByEmail.get(email);
      if (savedAccount) {
        existing.contactAccounts += 1;
        const linked = savedAccount.personId
          ? personById.get(savedAccount.personId)
          : undefined;
        if (linked && saved && linked.companyId !== saved.id) {
          errors.push(`Contact ${email} conflicts with an identity in another company`);
        }
        const grantExists = saved
          ? savedGrants.some(
              (grant) =>
                grant.userAccountId === savedAccount.id &&
                grant.companyId === saved.id &&
                grant.role === role,
            )
          : false;
        if (grantExists) existing.roleAssignments += 1;
        else inserts.roleAssignments += 1;
      } else {
        inserts.contactAccounts += 1;
        inserts.roleAssignments += 1;
      }
    }
  }

  const incomingRefs = new Set<string>();
  const incomingTypes = new Set<string>();
  for (const row of parsed.capacities) {
    if (!incomingRefs.has(row.vendorOrgRef)) {
      incomingRefs.add(row.vendorOrgRef);
      if (accountByRef.has(row.vendorOrgRef)) existing.vendorAccounts += 1;
      else inserts.vendorAccounts += 1;
    }
    if (!incomingTypes.has(row.licenseType)) {
      incomingTypes.add(row.licenseType);
      if (licenseByName.has(row.licenseType)) existing.licenseTypes += 1;
      else inserts.licenseTypes += 1;
    }
    const account = accountByRef.get(row.vendorOrgRef);
    const license = licenseByName.get(row.licenseType);
    const found = account && license
      ? savedCapacities.find(
          (capacity) =>
            capacity.vendorAccountId === account.id &&
            capacity.licenseTypeId === license.id &&
            capacity.effectiveFrom === row.effectiveFrom,
        )
      : undefined;
    if (found) {
      existing.capacities += 1;
      if (
        found.purchasedQty !== row.purchasedQty ||
        found.note !== row.note
      ) {
        errors.push(
          `Capacity ${row.vendorOrgRef}/${row.licenseType}/${row.effectiveFrom} conflicts with its existing record`,
        );
      }
    } else {
      inserts.capacities += 1;
    }
  }

  for (const row of parsed.members) {
    const savedPerson = personByEmail.get(row.email);
    if (savedPerson) {
      existing.people += 1;
      const targetCompany = companyByCode.get(row.companyCode);
      if (targetCompany && savedPerson.companyId !== targetCompany.id) {
        errors.push(`Member ${row.email} conflicts with another company`);
      }
      if (savedPerson.fullName !== row.fullName) {
        errors.push(`Member ${row.email} conflicts with its existing identity`);
      }
    } else {
      inserts.people += 1;
    }
    const savedRequest = requestByNumber.get(requestNumber(row));
    if (savedRequest) {
      existing.requests += 1;
      if (assignmentRequestIds.has(savedRequest.id)) existing.assignments += 1;
      else inserts.assignments += 1;
    } else {
      inserts.requests += 1;
      inserts.assignments += 1;
    }
  }

  return { inserts, existing, errors: [...new Set(errors)] };
}

export async function runGoLiveImport(
  database: ImportDatabase,
  input: GoLiveImportInput,
) {
  return goLiveImportService.import(database, input);
}

export const goLiveImportService = {
  async import(database: ImportDatabase, input: GoLiveImportInput) {
    const occurredAt = input.occurredAt ?? new Date();
    return withAudit(database, async (transaction) => {
    const dryRun = await dryRunGoLiveImport(
      transaction as unknown as ImportDatabase,
      input,
    );
    if (dryRun.errors.length > 0) {
      throw new Error(`Go-live import validation failed: ${dryRun.errors.join("; ")}`);
    }
    const parsed = parseInput(input);
    const companyCounts = await importCompanies(
      transaction,
      parsed.companies,
      input.actorUserId,
      occurredAt,
    );
    const vendorCounts = await seedAnthropicCatalog(
      transaction,
      parsed.capacities,
      input.actorUserId,
      occurredAt,
      input.credentials,
      input.kek,
      input.randomBytes,
    );
    const savedCompanies = await transaction.select().from(company);
    const companyByCode = new Map(savedCompanies.map((row) => [row.code, row]));
    const [anthropic] = await transaction
      .select()
      .from(vendor)
      .where(eq(vendor.name, "Anthropic"))
      .limit(1);
    const accounts = await transaction
      .select()
      .from(vendorAccount)
      .where(eq(vendorAccount.vendorId, anthropic.id));
    const accountByRef = new Map(accounts.map((row) => [row.vendorOrgRef, row]));
    const licenses = await transaction
      .select()
      .from(licenseType)
      .where(eq(licenseType.vendorId, anthropic.id));
    const licenseByName = new Map(licenses.map((row) => [row.name, row]));
    let peopleCreated = 0;
    let requestsCreated = 0;
    let assignmentsCreated = 0;

    for (const row of parsed.members) {
      const targetCompany = companyByCode.get(row.companyCode);
      const targetAccount = accountByRef.get(row.vendorOrgRef);
      const targetLicense = licenseByName.get(row.licenseType);
      if (!targetCompany || !targetAccount || !targetLicense) {
        throw new Error(`Validated import reference disappeared for ${row.email}`);
      }
      let [savedPerson] = await transaction
        .select()
        .from(person)
        .where(eq(person.email, row.email))
        .limit(1);
      if (!savedPerson) {
        [savedPerson] = await transaction.insert(person).values({
          email: row.email,
          fullName: row.fullName,
          companyId: targetCompany.id,
          status: "active",
          createdAt: occurredAt,
          createdBy: input.actorUserId,
        }).returning();
        peopleCreated += 1;
      }
      const requestNo = requestNumber(row);
      let [request] = await transaction
        .select()
        .from(licenseRequest)
        .where(eq(licenseRequest.requestNo, requestNo))
        .limit(1);
      if (!request) {
        [request] = await transaction.insert(licenseRequest).values({
          requestNo,
          personId: savedPerson.id,
          companyId: targetCompany.id,
          vendorAccountId: targetAccount.id,
          licenseTypeId: targetLicense.id,
          state: "active",
          justification: "importación inicial",
          createdAt: occurredAt,
          createdBy: null,
        }).returning();
        requestsCreated += 1;
        await transaction.insert(requestTransition).values({
          requestId: request.id,
          fromState: null,
          toState: "active",
          actorUserId: null,
          note: "importación inicial",
          occurredAt,
        });
      }
      let [assignment] = await transaction
        .select()
        .from(licenseAssignment)
        .where(eq(licenseAssignment.sourceRequestId, request.id))
        .limit(1);
      if (!assignment) {
        [assignment] = await transaction.insert(licenseAssignment).values({
          personId: savedPerson.id,
          companyId: targetCompany.id,
          vendorAccountId: targetAccount.id,
          licenseTypeId: targetLicense.id,
          startedOn: row.startedOn,
          sourceRequestId: request.id,
          sourceKind: "import",
          note: "importación inicial",
          createdAt: occurredAt,
          createdBy: null,
        }).returning();
        assignmentsCreated += 1;
        await transaction
          .update(licenseRequest)
          .set({ licenseAssignmentId: assignment.id })
          .where(eq(licenseRequest.id, request.id));
        await transaction.insert(auditLog).values({
          actorUserId: null,
          action: "license_assignment.imported",
          entityType: "LicenseAssignment",
          entityId: assignment.id,
          companyId: targetCompany.id,
          note: "importación inicial",
          before: null,
          after: {
            request_no: requestNo,
            source_kind: "import",
            started_on: row.startedOn,
          },
          occurredAt,
        });
      }
    }

    const reconciliation = await reconcileImport(
      transaction,
      parsed.members,
      parsed.capacities,
      accountByRef,
      licenseByName,
    );
    const failed = reconciliation.filter((line) => line.delta !== 0);
    if (failed.length > 0) {
      throw new Error(
        `Go-live reconciliation failed: ${failed.map((line) =>
          `${line.vendorOrgRef}/${line.licenseType} delta=${line.delta}`).join(", ")}`,
      );
    }
    const created = {
      ...companyCounts,
      ...vendorCounts,
      people: peopleCreated,
      requests: requestsCreated,
      assignments: assignmentsCreated,
    };
    return {
      value: { created, reconciliation },
      audit: {
        actorUserId: input.actorUserId,
        action: "go_live_import.completed",
        entityType: "UserAccount",
        entityId: input.actorUserId,
        companyId: null,
        note: "US-007 validated go-live import",
        before: null,
        after: { created, reconciliation },
      },
    };
    }, { occurredAt });
  },
};

async function reconcileImport(
  transaction: Parameters<Parameters<ImportDatabase["transaction"]>[0]>[0],
  members: readonly MemberBackfillRow[],
  capacities: readonly CapacityImportRow[],
  accountByRef: ReadonlyMap<string | null, typeof vendorAccount.$inferSelect>,
  licenseByName: ReadonlyMap<string, typeof licenseType.$inferSelect>,
): Promise<ReconciliationLine[]> {
  const assignments = await transaction
    .select()
    .from(licenseAssignment)
    .where(and(eq(licenseAssignment.sourceKind, "import")));
  return capacities.map((capacity) => {
    const account = accountByRef.get(capacity.vendorOrgRef);
    const license = licenseByName.get(capacity.licenseType);
    const consoleMembers = members.filter(
      (member) =>
        member.vendorOrgRef === capacity.vendorOrgRef &&
        member.licenseType === capacity.licenseType,
    ).length;
    const importedAssignments = assignments.filter(
      (assignment) =>
        assignment.vendorAccountId === account?.id &&
        assignment.licenseTypeId === license?.id &&
        assignment.endedOn === null,
    ).length;
    const purchaseDelta = capacity.purchasedQty - consoleMembers;
    const registerDelta = consoleMembers - importedAssignments;
    return {
      vendorOrgRef: capacity.vendorOrgRef,
      licenseType: capacity.licenseType,
      purchased: capacity.purchasedQty,
      consoleMembers,
      importedAssignments,
      delta: purchaseDelta !== 0 ? purchaseDelta : registerDelta,
    };
  });
}
