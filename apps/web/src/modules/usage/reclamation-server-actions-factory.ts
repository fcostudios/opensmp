import { ROUTE_SCR_USAGE } from "@/lib/routes";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { createReclamationOperations, reclamationActionError } from "./reclamation-operations";
import type { ReclamationCounts, ReclamationResult } from "./reclamation-command";

export function createReclamationServerActions({ database, loadAuthorization, now, revalidate }: {
  database: Parameters<typeof createReclamationOperations>[0]["database"];
  loadAuthorization: () => Promise<LedgerAuthorization | null>; now?: () => Date;
  revalidate: (path: string) => void | Promise<void>;
}) {
  const actions = createReclamationOperations({ database, now });
  return { async proposeReclamations(input: unknown): Promise<ReclamationResult> {
    let authorization: LedgerAuthorization | null;
    try { authorization = await loadAuthorization(); } catch { return { status: "error", code: "unexpected" }; }
    if (!authorization) return { status: "error", code: "access_denied" };
    let result: ReclamationCounts;
    try { result = await actions.proposeReclamations(authorization, input); } catch (error) { return reclamationActionError(error); }
    await revalidate(ROUTE_SCR_USAGE);
    return { status: "success", created: result.created, existing: result.existing };
  } };
}
