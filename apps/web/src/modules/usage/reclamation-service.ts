import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AuditRecordInput } from "@smp/domain/audit";
import { hasCapability } from "@smp/domain/identity-access";
// eslint-disable-next-line no-restricted-imports -- This service owns the audited batch transaction.
import * as schema from "@smp/db/schema";
// eslint-disable-next-line no-restricted-imports -- Additional proposal audits share the audited transaction.
import { auditLog } from "@smp/db/schema";
// eslint-disable-next-line no-restricted-imports -- Persistence executes within this service's audited transaction.
import { insertReclamationProposals, ReclamationPersistenceError } from "@smp/db/reclamation-proposals";
import { redactAuditValue, withAudit } from "../audit/with-audit";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { parseReclamationCommand, type ReclamationCounts } from "./reclamation-command";

/** A read-only transaction outcome; withAudit must not emit a synthetic batch audit. */
export class NoNewReclamationProposals extends Error {
  constructor(readonly counts: ReclamationCounts) { super("no_new_proposals"); }
}
function rethrowReclamationFailure(error: unknown): never { throw error; }

export function createReclamationProposalService(database: NodePgDatabase<typeof schema>, options: { now?: () => Date } = {}) {
  const now = options.now ?? (() => new Date());
  return {
    async proposeReclamations(authorization: LedgerAuthorization, input: unknown): Promise<ReclamationCounts> {
      const occurredAt = now();
      try {
        return await withAudit(database, async tx => {
          if (authorization.globalRole !== "group_admin") throw new ReclamationPersistenceError("access_denied");
          const command = parseReclamationCommand(input);
          const allowedCompanyIds = authorization.companyIds.filter(id => hasCapability(authorization, "company:write", id));
          const result = await insertReclamationProposals(tx, { personIds: command.person_ids, allowedCompanyIds,
            companyId: command.company_id, actorUserId: authorization.userAccountId, note: command.note, occurredAt });
          const counts = { created: result.inserted.length, existing: result.existing };
          if (counts.created === 0) throw new NoNewReclamationProposals(counts);
          const audits: AuditRecordInput[] = result.inserted.map(({ proposal, companyId }) => ({
            actorUserId: authorization.userAccountId, action: "reclamation.proposed", entityType: "ReclamationProposal",
            entityId: proposal.id, companyId, note: proposal.proposalNote, before: null,
            after: { assignment_id: proposal.assignmentId, proposed_by: proposal.proposedBy, status: proposal.status,
              proposal_note: proposal.proposalNote, client_request_id: command.client_request_id },
          }));
          for (const audit of audits.slice(1)) await tx.insert(auditLog).values({
            actorUserId: audit.actorUserId, action: audit.action, entityType: audit.entityType, entityId: audit.entityId,
            companyId: audit.companyId, note: audit.note, before: redactAuditValue(audit.before), after: redactAuditValue(audit.after), occurredAt,
          });
          return { value: counts, audit: audits[0] };
        }, { occurredAt });
      } catch (error) {
        rethrowReclamationFailure(error);
      }
    },
  };
}
