import { redirect } from "next/navigation";
import { reconciliationKey } from "@smp/contracts/reconciliation";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import { ROUTE_SCR_ACCESS_DENIED } from "@/lib/routes";
import { closeDatabase } from "@/modules/close/production";
import { createReconciliationService } from "@/modules/close/reconciliation-transaction";
import { ReconciliationView } from "@/modules/close/reconciliation-view";
import { saveInvoiceAmount, overrideReconciliation, saveVarianceLine, deleteVarianceLine } from "@/modules/close/reconciliation-actions";
export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const authorization = await loadCurrentLedgerAuthorization();
  if (!authorization || (authorization.globalRole !== "central_finance" && authorization.globalRole !== "group_admin")) redirect(ROUTE_SCR_ACCESS_DENIED);
  const params = await searchParams;
  const parsed = reconciliationKey.shape.period.safeParse(params.period);
  const period = parsed.success ? parsed.data : new Date(new Date().valueOf() - 5 * 60 * 60 * 1000).toISOString().slice(0, 7);
  const cards = await createReconciliationService(closeDatabase).cards(authorization, period);
  return <ReconciliationView key={period} period={period} cards={cards} actions={{ saveInvoiceAmount, overrideReconciliation, saveVarianceLine, deleteVarianceLine }}/>;
}
