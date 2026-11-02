import { createCloseService } from "./close-transaction";
import type { LedgerAuthorization } from "../identity-access/authorization";
export function createCloseOperations({ database, now }: { database: Parameters<typeof createCloseService>[0]; now?: () => Date }) {
  const service = createCloseService(database, { now });
  return { async runClose(authorization: LedgerAuthorization, form: FormData) {
    return service.runClose(authorization, { period: form.get("period"), note: form.get("note") || null });
  } };
}
