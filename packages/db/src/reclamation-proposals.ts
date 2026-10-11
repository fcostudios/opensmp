import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { licenseAssignment, person, reclamationProposal } from "./schema";

export type ReclamationTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]>[0];
export type InsertedReclamation = Readonly<{ proposal: typeof reclamationProposal.$inferSelect; companyId: string }>;
export class ReclamationPersistenceError extends Error {
  constructor(readonly code: "access_denied" | "selection_changed") { super(code); }
}

/** Locks the complete authorized selection before creating any pending proposal. */
export async function insertReclamationProposals(tx: ReclamationTransaction, input: {
  readonly personIds: readonly string[]; readonly allowedCompanyIds: readonly string[];
  readonly companyId?: string; readonly actorUserId: string;
  readonly note: string | null; readonly occurredAt: Date;
}): Promise<{ readonly inserted: readonly InsertedReclamation[]; readonly existing: number }> {
  if (input.allowedCompanyIds.length === 0 || (input.companyId && !input.allowedCompanyIds.includes(input.companyId))) {
    throw new ReclamationPersistenceError("access_denied");
  }
  const people = await tx.select({ id: person.id }).from(person).where(and(
    inArray(person.id, [...input.personIds]), inArray(person.companyId, [...input.allowedCompanyIds]),
    input.companyId ? eq(person.companyId, input.companyId) : undefined,
  )).orderBy(asc(person.id)).for("update");
  if (people.length !== input.personIds.length) throw new ReclamationPersistenceError("access_denied");
  const assignments = await tx.select({ id: licenseAssignment.id, personId: licenseAssignment.personId, companyId: licenseAssignment.companyId }).from(licenseAssignment)
    .innerJoin(person, and(eq(person.id, licenseAssignment.personId), eq(person.companyId, licenseAssignment.companyId)))
    .where(and(inArray(licenseAssignment.personId, [...input.personIds]),
      inArray(licenseAssignment.companyId, [...input.allowedCompanyIds]), inArray(person.companyId, [...input.allowedCompanyIds]),
      input.companyId ? eq(licenseAssignment.companyId, input.companyId) : undefined, isNull(licenseAssignment.endedOn)))
    .orderBy(asc(licenseAssignment.id)).for("update", { of: licenseAssignment });
  if (new Set(assignments.map(a => a.personId)).size !== input.personIds.length) throw new ReclamationPersistenceError("selection_changed");
  const proposals = await tx.insert(reclamationProposal).values(assignments.map(a => ({
    assignmentId: a.id, proposedBy: input.actorUserId, proposalNote: input.note,
    status: "pending" as const, createdAt: input.occurredAt,
  }))).onConflictDoNothing({ target: reclamationProposal.assignmentId, where: sql`${reclamationProposal.status} = 'pending'` }).returning();
  const companyByAssignment = new Map(assignments.map(a => [a.id, a.companyId]));
  return { inserted: proposals.map(proposal => ({ proposal, companyId: companyByAssignment.get(proposal.assignmentId)! })), existing: assignments.length - proposals.length };
}
