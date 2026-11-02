import { createCloseService } from "./close-transaction";
import type { LedgerAuthorization } from "../identity-access/authorization";
export function createCloseOperations({ database, now }: { database: Parameters<typeof createCloseService>[0]; now?: () => Date }) {
  const service = createCloseService(database, { now });
  return { async runClose(authorization: LedgerAuthorization, form: FormData) {
    return service.runClose(authorization, { period: form.get("period"), note: form.get("note") || null });
  },
  async finalizeStatement(authorization: LedgerAuthorization, form: FormData) {
    return service.finalizeStatement(authorization, { period: form.get("period"), statementId: form.get("statementId"), confirmed: form.get("confirmed") === "true" });
  },
  async finalizeStatements(authorization: LedgerAuthorization, form: FormData) {
    return service.finalizeStatements(authorization, { period: form.get("period"), confirmed: form.get("confirmed") === "true" });
  } };
}
