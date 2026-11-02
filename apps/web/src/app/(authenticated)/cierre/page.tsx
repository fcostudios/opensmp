import { Fragment } from "react";
import { redirect } from "next/navigation";
import { runCloseSchema } from "@smp/contracts/close";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import { ROUTE_SCR_ACCESS_DENIED } from "@/lib/routes";
import { loadCloseStatements, loadLatestCloseRun } from "@/modules/close/production";
import { finalizeStatement, finalizeStatements, runClose } from "@/modules/close/server-actions";
import { FinalizationPanel } from "@/modules/close/finalization-panel";
import { CloseView } from "@/modules/close/close-view";
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
  const [latest, statements] = await Promise.all([loadLatestCloseRun(authorization, period), loadCloseStatements(authorization, period)]);
  return <Fragment key={period}><CloseView period={period} latest={latest} action={runClose} />
    <FinalizationPanel period={period} statements={statements} singleAction={finalizeStatement} periodAction={finalizeStatements} /></Fragment>;
}
