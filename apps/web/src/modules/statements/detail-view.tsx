import { Fragment } from "react";
import Link from "next/link";
import { formatUsd, RegisterDrilldown } from "@smp/ui";
import { serializeRegisterFilters } from "@smp/contracts/register";
import type messages from "../../../messages/en-US.json";
import type { StatementDetail } from "./repository";
import { ROUTE_SCR_REGISTER, ROUTE_SCR_STATEMENTS } from "@/lib/routes";

export function StatementDetailView({ detail, canViewRegister, locale, copy: t, registerLabels }: {
  detail: StatementDetail;
  canViewRegister: boolean;
  locale: "en-US" | "es-EC";
  copy: typeof messages.statementDetail;
  registerLabels: typeof messages.register;
}) {
  const date = (value: string | null) => value ? new Intl.DateTimeFormat(locale, { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)) : "—";
  const { statement, lines } = detail;
  return <main className="space-y-6 p-4 sm:p-6">
    <Link className="text-primary underline" href={ROUTE_SCR_STATEMENTS}>{t.back}</Link>
    <header className="space-y-2 border-b border-border pb-4">
      <h1 className="font-display text-3xl font-semibold text-text-primary">{t.title} · {detail.companyName} ({detail.companyCode}) · {statement.period}</h1>
      <p className="text-text-secondary">{t.licenseOnly}</p>
    </header>
    {statement.status !== "final" && <p data-testid="status_banner" className="rounded border border-border bg-info-bg p-4 text-info-text">{statement.status === "draft" ? t.draft : t.reconciled}</p>}
    <dl data-testid="statement_tiles" className="grid gap-4 rounded border border-border bg-surface p-4 sm:grid-cols-3">
      <div data-testid="tile_total"><dt>{t.total}</dt><dd className="font-mono text-xl">{formatUsd(Number(statement.totalUsd), locale)}</dd></div>
      <div><dt>{t.openingSeats}</dt><dd>{statement.openingSeats}</dd></div>
      <div><dt>{t.generatedAt}</dt><dd><time dateTime={statement.generatedAt.toISOString()}>{date(statement.generatedAt.toISOString().slice(0, 10))}</time></dd></div>
    </dl>
    <section data-testid="statement_lines" className="space-y-4">
      <h2 className="text-xl font-semibold">{t.lines}</h2>
      {lines.length === 0 ? <p>{t.empty}</p> : <div className="overflow-x-auto rounded border border-border bg-surface"><table className="w-full text-left text-sm">
        <caption className="sr-only">{t.lines}</caption>
        <thead><tr>{[t.kind,t.person,t.organization,t.licenseType,t.periodFrom,t.periodTo,t.seatDays,t.rate,t.amount,t.note].map(label => <th className="whitespace-nowrap border-b border-border p-3" scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{lines.map(line => {
          const assignment = line.assignment;
          const note = line.kind === "adjustment" && !line.note?.trim() ? t.missingNote : line.note ?? "—";
          return <Fragment key={line.id}>
            <tr data-line-id={line.id}>
              <td className="p-3">{line.kind === "license" ? t.license : t.adjustment}</td><td className="p-3">{line.personName ?? "—"}</td><td className="p-3">{line.vendorAccountName}</td><td className="p-3">{line.licenseTypeName ?? "—"}</td>
              <td className="whitespace-nowrap p-3">{date(line.periodFrom)}</td><td className="whitespace-nowrap p-3">{date(line.periodTo)}</td><td className="p-3 text-right">{line.licenseDays ?? "—"}</td>
              <td className="whitespace-nowrap p-3 text-right">{line.rateUsd === null ? "—" : formatUsd(Number(line.rateUsd), locale)}</td><td className="whitespace-nowrap p-3 text-right">{formatUsd(Number(line.amountUsd), locale)}</td><td className="whitespace-pre-wrap p-3">{note}</td>
              </tr>
            <tr><td colSpan={10} className="border-b border-border p-3"><details><summary className="cursor-pointer text-primary">{t.evidence}</summary>
                <div className="space-y-3 p-4">
                  {line.kind === "adjustment" ? <p className="whitespace-pre-wrap">{note}</p> : assignment ? <div data-testid="register_drilldown" className="space-y-3">
                    <p>{t.assignmentId}: {assignment.id}</p>
                    <RegisterDrilldown titleId={`statement-line-${line.id}`} assignment={assignment} labels={registerLabels} locale={locale} />
                    <p>{t.source}: {registerLabels[({manual:"sourceManual",request:"sourceRequest",import:"sourceImport",reconciliation:"sourceReconciliation"} as const)[assignment.sourceKind]]}</p>
                    {assignment.note && <p className="whitespace-pre-wrap">{t.note}: {assignment.note}</p>}
                    {canViewRegister && <Link data-testid="btn_view_register" className="text-primary underline" href={`${ROUTE_SCR_REGISTER}?${serializeRegisterFilters({companyId:assignment.companyId,personId:assignment.personId,vendorAccountId:assignment.vendorAccountId,licenseTypeId:assignment.licenseTypeId,startDate:assignment.startedOn,endDate:assignment.startedOn})}`}>{t.viewRegister}</Link>}
                  </div> : <p>{t.missingEvidence}</p>}
                </div>
              </details></td>
            </tr>
          </Fragment>;
        })}</tbody>
      </table></div>}
    </section>
  </main>;
}
