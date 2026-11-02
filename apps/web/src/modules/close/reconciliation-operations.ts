import { createReconciliationService } from "./reconciliation-transaction";
import type { LedgerAuthorization } from "../identity-access/authorization";
export function createReconciliationOperations({ database }: { database: Parameters<typeof createReconciliationService>[0] }) {
  const service = createReconciliationService(database);
  return {
    async saveInvoiceAmount(auth: LedgerAuthorization, form: FormData) {
      return service.saveInvoiceAmount(auth, { period: form.get("period"), vendorAccountId: form.get("vendorAccountId"), invoiceAmountUsd: form.get("invoiceAmountUsd") });
    },
    async overrideReconciliation(auth: LedgerAuthorization, form: FormData) {
      return service.overrideReconciliation(auth, { period: form.get("period"), vendorAccountId: form.get("vendorAccountId"), note: form.get("note") });
    },
    async saveVarianceLine(auth: LedgerAuthorization, form: FormData) {
      return service.saveVarianceLine(auth, { period: form.get("period"), vendorAccountId: form.get("vendorAccountId"), lineId: form.get("lineId") || undefined,
        cause: form.get("cause"), detail: form.get("detail"), registerAmountUsd: form.get("registerAmountUsd"), invoiceAmountUsd: form.get("invoiceAmountUsd"), evidenceUrl: form.get("evidenceUrl") || null });
    },
    async deleteVarianceLine(auth: LedgerAuthorization, form: FormData) {
      return service.deleteVarianceLine(auth, { period: form.get("period"), vendorAccountId: form.get("vendorAccountId"), lineId: form.get("lineId") });
    },
  };
}
