import { Fragment } from "react";
import { redirect } from "next/navigation";
import { runCloseSchema } from "@smp/contracts/close";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import { ROUTE_SCR_ACCESS_DENIED } from "@/lib/routes";
import { finalizeStatement, finalizeStatements, runClose } from "@/modules/close/server-actions";
import { FinalizationPanel } from "@/modules/close/finalization-panel";
import { CloseView } from "@/modules/close/close-view";
import { closeDatabase, loadLatestCloseRun } from "@/modules/close/production";
import { createRollupService } from "@/modules/close/rollup-transaction";
import { RollupPanel } from "@/modules/close/rollup-panel";
import { exportRollupCsv } from "@/modules/close/rollup-actions";
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
  const [rollup, latest] = await Promise.all([
    createRollupService(closeDatabase).read(authorization, period),
    loadLatestCloseRun(authorization, period),
  ]);
  const statements = rollup.statements;
  const messages = await loadAppMessages(await getLocale());
  return <Fragment key={period}><CloseView period={period} latest={latest} action={runClose} tiles={<StatementSummary data={statements} t={messages.statements}/>}/><section className="space-y-6 p-6">
    <RollupPanel period={period} reconciliationTotalUsd={rollup.reconciliationTotalUsd} ties={rollup.ties} action={exportRollupCsv} t={messages.rollup}/>
    <div data-testid="statements_by_company"><StatementTable data={statements} t={messages.statements}/></div>
  </section><FinalizationPanel period={period} statements={statements.rows.map(({id,companyName,status})=>({id,companyName,status}))} singleAction={finalizeStatement} periodAction={finalizeStatements}/></Fragment>;
}
