import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { statementFiltersSchema } from "@smp/contracts/statements";
import { ROUTE_SCR_ACCESS_DENIED } from "@/lib/routes";
import { loadAppMessages } from "@/lib/i18n/messages";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import { statementCompanyIds } from "@/modules/statements/repository";
import { loadStatementRegister } from "@/modules/statements/production";
import { StatementsView } from "@/modules/statements/statement-view";

export default async function StatementsPage({ searchParams }: { searchParams: Promise<{period?:string;companyId?:string;status?:string}> }) {
  const authorization = await loadCurrentLedgerAuthorization();
  try { statementCompanyIds(authorization); } catch { redirect(ROUTE_SCR_ACCESS_DENIED); }
  const params = await searchParams;
  const parts = new Intl.DateTimeFormat("en", { timeZone:"America/Guayaquil",year:"numeric",month:"numeric" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const previous = new Date(Date.UTC(year,month-2,1)).toISOString().slice(0,7);
  const parsed = statementFiltersSchema.safeParse({ period:params.period || previous, companyId:params.companyId || undefined, status:params.status || undefined });
  if (!parsed.success) redirect(ROUTE_SCR_ACCESS_DENIED);
  const ids = statementCompanyIds(authorization);
  if (parsed.data.companyId && !ids.includes(parsed.data.companyId)) redirect(ROUTE_SCR_ACCESS_DENIED);
  const data = await loadStatementRegister(authorization!, parsed.data);
  const messages = await loadAppMessages(await getLocale());
  return <StatementsView data={data} filters={parsed.data} canFilterCompany={authorization!.globalRole !== null} t={messages.statements}/>;
}
