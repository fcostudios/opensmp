import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { closeManualAssignmentSchema, recordManualAssignmentSchema } from "@smp/contracts/register";
import { db } from "@smp/db";
import * as schema from "@smp/db/schema";
import { company, licenseAssignment, licenseRequest, licenseType, person, requestTransition, statement, vendorAccount } from "@smp/db/schema";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { withAudit } from "../audit/with-audit";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function requireAdmin(authorization: LedgerAuthorization | null): LedgerAuthorization {
  if (!authorization || authorization.globalRole !== "group_admin") throw new Error("Forbidden");
  return authorization;
}

function requireCompany(authorization: LedgerAuthorization, companyId: string) {
  if (!authorization.companyIds.includes(companyId)) throw new Error("Forbidden");
}

async function protectFinalPeriods(transaction: Transaction, companyId: string, changedFrom: string) {
  const finals = await transaction.select({ id: statement.id }).from(statement).where(and(
    eq(statement.companyId, companyId), inArray(statement.status, ["final", "reconciled"]),
    gte(statement.period, changedFrom.slice(0, 7)),
  )).for("update");
  if (finals.length) throw new Error("FinalizedPeriod");
}

/** Manual register commands deliberately never invoke provisioning or observations. */
export function createManualRegisterService(database: Database) {
  return {
    async record(authorization: LedgerAuthorization | null, input: unknown, occurredAt = new Date()) {
      return withAudit(database, async (transaction) => {
        const actor = requireAdmin(authorization);
        const values = recordManualAssignmentSchema.parse(input);
        requireCompany(actor, values.companyId);
        // Serialize manual register edits for the tenant, including empty periods.
        const [targetCompany] = await transaction.select().from(company).where(eq(company.id, values.companyId)).for("update");
        if (!targetCompany || targetCompany.status !== "active") throw new Error("InvalidReference");
        const [targetPerson] = await transaction.select().from(person).where(and(eq(person.id, values.personId), eq(person.companyId, values.companyId)));
        const [account] = await transaction.select().from(vendorAccount).where(eq(vendorAccount.id, values.vendorAccountId));
        const [license] = await transaction.select().from(licenseType).where(eq(licenseType.id, values.licenseTypeId));
        if (!targetPerson || targetPerson.status !== "active" || !account || account.status !== "active" || !license || license.status !== "active" || account.vendorId !== license.vendorId) throw new Error("InvalidReference");
        await protectFinalPeriods(transaction, values.companyId, values.startedOn);
        const [anchor] = await transaction.insert(licenseRequest).values({
          requestNo: `MAN-${randomUUID()}`, personId: values.personId, companyId: values.companyId,
          vendorAccountId: values.vendorAccountId, licenseTypeId: values.licenseTypeId,
          state: "active", justification: values.note, createdAt: occurredAt, createdBy: null,
        }).returning();
        await transaction.insert(requestTransition).values({ requestId: anchor!.id, fromState: null, toState: "active", actorUserId: null, note: values.note, occurredAt });
        const [assignment] = await transaction.insert(licenseAssignment).values({
          ...values, sourceKind: "manual", sourceRequestId: anchor!.id, createdBy: actor.userAccountId, createdAt: occurredAt,
        }).returning();
        await transaction.update(licenseRequest).set({ licenseAssignmentId: assignment!.id }).where(and(eq(licenseRequest.id, anchor!.id), eq(licenseRequest.companyId, values.companyId)));
        return { value: assignment!, audit: { actorUserId: actor.userAccountId, companyId: values.companyId, action: "license_assignment.manual_recorded", entityType: "LicenseAssignment", entityId: assignment!.id, before: null, after: assignment!, note: values.note } };
      }, { occurredAt });
    },
    async close(authorization: LedgerAuthorization | null, input: unknown, occurredAt = new Date()) {
      return withAudit(database, async (transaction) => {
        const actor = requireAdmin(authorization);
        const values = closeManualAssignmentSchema.parse(input);
        const [assignment] = await transaction.select().from(licenseAssignment).where(and(
          eq(licenseAssignment.id, values.assignmentId), inArray(licenseAssignment.companyId, [...actor.companyIds]),
        )).for("update");
        if (!assignment) throw new Error("Forbidden");
        requireCompany(actor, assignment.companyId);
        if (assignment.sourceKind !== "manual" || assignment.endedOn !== null) throw new Error("InvalidAssignment");
        if (values.endedOn < assignment.startedOn) throw new Error("InvalidInterval");
        // ended_on is inclusive: only days AFTER the new end are rewritten.
        const changedFrom = new Date(`${values.endedOn}T00:00:00.000Z`);
        changedFrom.setUTCDate(changedFrom.getUTCDate() + 1);
        await protectFinalPeriods(transaction, assignment.companyId, changedFrom.toISOString().slice(0, 10));
        const [closed] = await transaction.update(licenseAssignment).set({ endedOn: values.endedOn, endReason: values.endReason }).where(and(eq(licenseAssignment.id, assignment.id), eq(licenseAssignment.companyId, assignment.companyId), sql`${licenseAssignment.endedOn} IS NULL`)).returning();
        return { value: closed!, audit: { actorUserId: actor.userAccountId, companyId: assignment.companyId, action: "license_assignment.manual_closed", entityType: "LicenseAssignment", entityId: assignment.id, before: assignment, after: closed!, note: values.note } };
      }, { occurredAt });
    },
  };
}

export const manualRegisterService = createManualRegisterService(db as unknown as Database);
