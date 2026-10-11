import { ZodError } from "zod";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
// eslint-disable-next-line no-restricted-imports -- Types the audited transaction composition.
import * as schema from "@smp/db/schema";
// eslint-disable-next-line no-restricted-imports -- Pure error identity for the action result mapper.
import { ReclamationPersistenceError } from "@smp/db/reclamation-proposals";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { createReclamationProposalService, NoNewReclamationProposals } from "./reclamation-service";
import type { ReclamationCounts, ReclamationResult } from "./reclamation-command";

export function reclamationActionError(error: unknown): ReclamationResult {
  if (error instanceof NoNewReclamationProposals) return { status: "success", ...error.counts };
  if (error instanceof ZodError) return { status: "error", code: "invalid_input" };
  if (error instanceof ReclamationPersistenceError) return { status: "error", code: error.code };
  return { status: "error", code: "unexpected" };
}
export function createReclamationOperations({ database, now }: { database: NodePgDatabase<typeof schema>; now?: () => Date }) {
  const service = createReclamationProposalService(database, { now });
  return { async proposeReclamations(authorization: LedgerAuthorization, input: unknown): Promise<ReclamationCounts> {
    return service.proposeReclamations(authorization, input);
  } };
}
