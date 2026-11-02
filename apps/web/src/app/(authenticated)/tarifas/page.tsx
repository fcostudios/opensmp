import { loadRatesWorkspace } from "@/modules/vendor-catalog/rate-production";
import { redirect } from "next/navigation";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import { ROUTE_SCR_ACCESS_DENIED } from "@/lib/routes";
import { saveRateCard } from "@/modules/vendor-catalog/actions/manage-rates";
import { RatesView } from "@/modules/vendor-catalog/rates-view";
export default async function RatesPage() {
  const authorization = await loadCurrentLedgerAuthorization();
  // @equivalent: either null-role fallback is outside the explicit two-role allowlist.
  if (!authorization || !["central_finance", "group_admin"].includes(authorization.globalRole ?? "")) redirect(ROUTE_SCR_ACCESS_DENIED);
  const data = await loadRatesWorkspace(authorization);
  return <RatesView data={data} action={saveRateCard} />;
}
