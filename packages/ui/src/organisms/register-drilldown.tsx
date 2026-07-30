import type { ReactNode } from "react";

export interface RegisterDrilldownProps {
  readonly canViewStatements?: boolean;
  readonly locale: string;
  readonly assignment: {
    readonly companyName: string;
    readonly endedOn: string | null;
    readonly licenseTypeName: string;
    readonly personName: string;
    readonly sourceRequestApprovalState: "approved" | "pending" | "rejected" | null;
    readonly sourceRequestDecidedAt: string | null;
    readonly sourceRequestNo: string | null;
    readonly startedOn: string;
    readonly statementLines: readonly {
      readonly amountUsd: string;
      readonly id: string;
      readonly licenseDays: number | null;
      readonly periodFrom: string | null;
      readonly periodTo: string | null;
      readonly statementPeriod: string;
      readonly statementId?: string;
    }[];
    readonly vendorAccountName: string;
  };
  readonly labels: {
    readonly company: string;
    readonly drilldownSource: string;
    readonly drilldownDecisionDate: string;
    readonly drilldownStatementLines: string;
    readonly drilldownTitle: string;
    readonly endedOn: string;
    readonly licenseType: string;
    readonly organization: string;
    readonly person: string;
    readonly requestApproved: string;
    readonly requestPending: string;
    readonly requestRejected: string;
    readonly startedOn: string;
    readonly viewStatement?: string;
  };
}

function value(label: string, content: ReactNode) {
  return <div><dt className="text-xs uppercase tracking-wide text-text-muted">{label}</dt><dd className="mt-1 text-text-primary">{content}</dd></div>;
}

export function RegisterDrilldown({ assignment, canViewStatements, labels, locale }: RegisterDrilldownProps) {
  const dateFormatter = new Intl.DateTimeFormat(locale, { timeZone: "UTC" });
  const formatDate = (date: string | null) => date
    ? dateFormatter.format(new Date(date.length === 10 ? `${date}T00:00:00.000Z` : date))
    : "—";
  const approvalLabel = assignment.sourceRequestApprovalState === "approved"
    ? labels.requestApproved
    : assignment.sourceRequestApprovalState === "rejected"
      ? labels.requestRejected
      : labels.requestPending;
  const decisionDate = assignment.sourceRequestDecidedAt
    ? formatDate(assignment.sourceRequestDecidedAt)
    : null;
  const sourceTrace = assignment.sourceRequestNo
    ? [
      assignment.sourceRequestNo,
      approvalLabel,
      decisionDate ? `${labels.drilldownDecisionDate} ${decisionDate}` : null,
    ].filter(Boolean).join(" · ")
    : "—";
  return <section aria-labelledby="register-drilldown-title" data-organism="register-drilldown">
    <h2 className="text-xl font-semibold text-text-primary" id="register-drilldown-title">{labels.drilldownTitle}</h2>
    <dl className="mt-4 grid gap-4 sm:grid-cols-2">
      {value(labels.person, assignment.personName)}
      {value(labels.company, assignment.companyName)}
      {value(labels.organization, assignment.vendorAccountName)}
      {value(labels.licenseType, assignment.licenseTypeName)}
      {value(labels.startedOn, formatDate(assignment.startedOn))}
      {value(labels.endedOn, formatDate(assignment.endedOn))}
      {value(labels.drilldownSource, sourceTrace)}
    </dl>
    <h3 className="mt-6 font-semibold text-text-primary">{labels.drilldownStatementLines}</h3>
    <ul className="mt-2 divide-y divide-border border-y border-border">
      {assignment.statementLines.map((line) => <li className="grid gap-1 py-3 text-sm sm:grid-cols-3" key={line.id}>{canViewStatements && line.statementId && labels.viewStatement ? <a className="text-primary underline" href={`/estados-de-cuenta/${line.statementId}`}>{labels.viewStatement}</a> : <span>{line.statementPeriod}</span>}<span>{formatDate(line.periodFrom)} – {formatDate(line.periodTo)}</span><span>{line.licenseDays ?? "—"} · {line.amountUsd}</span></li>)}
    </ul>
  </section>;
}
