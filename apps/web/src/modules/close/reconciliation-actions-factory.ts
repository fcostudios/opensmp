import type { ReconciliationState } from "@smp/contracts/reconciliation";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { ROUTE_SCR_RECONCILIATION } from "@/lib/routes";
import { createReconciliationService } from "./reconciliation-transaction";
import { createReconciliationOperations } from "./reconciliation-operations";
export function createReconciliationActions({ database, loadAuthorization, revalidate }: {
  database: Parameters<typeof createReconciliationService>[0];
  loadAuthorization: () => Promise<LedgerAuthorization | null>;
  revalidate: (path: string) => void | Promise<void>;
}) {
  const actions = createReconciliationOperations({ database });
  return {
    async saveInvoiceAmount(_state: ReconciliationState, form: FormData): Promise<ReconciliationState> {
      let authorization: LedgerAuthorization | null;
      // @equivalent: an empty authorization catch leaves undefined; the next guard returns the same error without writes.
      try { authorization = await loadAuthorization(); } catch { return { status: "error" }; }
      // @equivalent: removing this guard reaches the service access check and its catch returns the same error without writes.
      if (!authorization) return { status: "error" };
      let row;
      try { row = await actions.saveInvoiceAmount(authorization, form); } catch { return { status: "error" }; }
      await revalidate(ROUTE_SCR_RECONCILIATION);
      return { status: row.status === "reconciled" ? "reconciled" : "saved" };
    },
    async overrideReconciliation(_state: ReconciliationState, form: FormData): Promise<ReconciliationState> {
      let authorization: LedgerAuthorization | null;
      // @equivalent: an empty authorization catch leaves undefined; the next guard returns the same error without writes.
      try { authorization = await loadAuthorization(); } catch { return { status: "error" }; }
      // @equivalent: removing this guard reaches the service access check and its catch returns the same error without writes.
      if (!authorization) return { status: "error" };
      let _row;
      try { _row = await actions.overrideReconciliation(authorization, form); } catch { return { status: "error" }; }
      await revalidate(ROUTE_SCR_RECONCILIATION);
      return { status: "overridden" };
    },
    async saveVarianceLine(_state: ReconciliationState, form: FormData): Promise<ReconciliationState> {
      let authorization: LedgerAuthorization | null;
      // @equivalent: an empty authorization catch leaves undefined; the next guard returns the same error without writes.
      try { authorization = await loadAuthorization(); } catch { return { status: "error" }; }
      // @equivalent: removing this guard reaches the service access check and its catch returns the same error without writes.
      if (!authorization) return { status: "error" };
      let _row;
      try { _row = await actions.saveVarianceLine(authorization, form); } catch { return { status: "error" }; }
      await revalidate(ROUTE_SCR_RECONCILIATION);
      return { status: "saved" };
    },
    async deleteVarianceLine(_state: ReconciliationState, form: FormData): Promise<ReconciliationState> {
      let authorization: LedgerAuthorization | null;
      // @equivalent: an empty authorization catch leaves undefined; the next guard returns the same error without writes.
      try { authorization = await loadAuthorization(); } catch { return { status: "error" }; }
      // @equivalent: removing this guard reaches the service access check and its catch returns the same error without writes.
      if (!authorization) return { status: "error" };
      let _row;
      try { _row = await actions.deleteVarianceLine(authorization, form); } catch { return { status: "error" }; }
      await revalidate(ROUTE_SCR_RECONCILIATION);
      return { status: "saved" };
    },
  };
}
