import { redirect } from "next/navigation";
import { runCloseSchema } from "@smp/contracts/close";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import { ROUTE_SCR_ACCESS_DENIED } from "@/lib/routes";
import { runClose } from "@/modules/close/server-actions";
import { CloseView } from "@/modules/close/close-view";
import { loadStatementRegister } from "@/modules/statements/production";
import { StatementSummary, StatementTable } from "@/modules/statements/statement-view";
import { getLocale } from "next-intl/server";
import { loadAppMessages } from "@/lib/i18n/messages";
export default async function ClosePage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const authorization = await loadCurrentLedgerAuthorization();
  // @equivalent: any missing-role fallback stays outside the explicit finance/admin allowlist.
  if (!authorization || !["central_finance", "group_admin"].includes(authorization.globalRole ?? "")) redirect(ROUTE_SCR_ACCESS_DENIED);
  const params = await searchParams;
  const local = new Intl.DateTimeFormat("en", { timeZone: "America/Guayaquil", year: "numeric", month: "numeric" }).formatToParts(new Date());
  const year = Number(local.find(part => part.type === "year")!.value);
  // @equivalent: en numeric month/year emits the month first; an always-true predicate picks that same month.
  const month = Number(local.find(part => part.type === "month")!.value);
  const previousMonth = new Date(Date.UTC(year, month - 2, 1));
  const parsed = runCloseSchema.safeParse({ period: params.period });
  const period = parsed.success ? parsed.data.period : previousMonth.toISOString().slice(0, 7);
  const statements = await loadStatementRegister(authorization, { period });
  const messages = await loadAppMessages(await getLocale());
  return <><CloseView key={period} period={period} latest={statements.latest} action={runClose}/><section className="space-y-6 p-6">
    <StatementSummary data={statements} t={messages.statements}/>
    <div data-testid="statements_by_company"><StatementTable data={statements} t={messages.statements}/></div>
  </section></>;
}
