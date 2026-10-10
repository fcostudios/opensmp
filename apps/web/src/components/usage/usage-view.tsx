import React from "react";
import Link from "next/link";
import type messages from "../../../messages/en-US.json";
import type { UsageReadModel } from "../../modules/usage/repository";
import { serializeUsageFilters } from "../../modules/usage/filters";
import { ROUTE_SCR_PERSON_DETAIL, ROUTE_SCR_USAGE } from "../../lib/routes";

export type UsageLabels = typeof messages.usage;
export function UsageView({ model, locale, labels }: { model: UsageReadModel; locale: string; labels: UsageLabels }) {
  const numbers = new Intl.NumberFormat(locale);
  const percentage = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const dates = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const date = (value: string) => <time dateTime={value}>{dates.format(new Date(`${value}T00:00:00Z`))}</time>;
  const windowLabel = (text: string) => text.replace("{window}", numbers.format(model.filters.window));
  const nextHref = model.nextCursor ? `${ROUTE_SCR_USAGE}?${new URLSearchParams(serializeUsageFilters({ ...model.filters, cursor: model.nextCursor }))}` : null;
  const selectClass = "min-h-11 rounded border border-border bg-surface px-3 text-text-primary";
  const badgeClass = "inline-flex rounded border border-border bg-surface-alt px-2 py-1 text-xs text-text-secondary";
  return (
    <main className="space-y-5 p-4 sm:p-6">
      <header className="border-b border-border pb-4">
        <h1 className="font-display text-3xl font-semibold text-text-primary">{labels.title}</h1>
        <p className="mt-1 text-text-secondary">{labels.subtitle}</p>
      </header>
      <section aria-label={labels.filters} data-testid="usage_filters">
        <form action={ROUTE_SCR_USAGE} className="flex flex-wrap items-end gap-4" method="get">
          <label className="grid gap-1 text-sm text-text-secondary" htmlFor="usage-company">
            {labels.company}
            <select className={selectClass} defaultValue={model.filters.companyId ?? ""} id="usage-company" name="companyId" data-testid="company">
              <option value="">{labels.allCompanies}</option>
              {model.companies.map(company => <option key={company.id} value={company.id}>{company.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm text-text-secondary" htmlFor="usage-window">
            {labels.window}
            <select className={selectClass} defaultValue={String(model.filters.window)} id="usage-window" name="window" data-testid="window">
              <option value="30">{labels.window30}</option><option value="60">{labels.window60}</option><option value="90">{labels.window90}</option>
            </select>
          </label>
          <button className="min-h-11 rounded bg-primary px-4 font-semibold text-white" type="submit">{labels.apply}</button>
        </form>
      </section>
      <section aria-label={labels.metrics} data-testid="usage_metrics">
        <p className="mb-2 text-sm text-text-secondary">{`${numbers.format(model.metrics.total)} ${labels.licenses}`}</p>
        <dl className="grid gap-4 md:grid-cols-3">
          <div className="rounded border border-border bg-surface p-4" data-testid="active_30d_pct">
            <dt className="text-sm text-text-secondary">{windowLabel(labels.activeWindow)}</dt>
            <dd className="mt-2 text-2xl font-semibold text-text-primary" data-count={model.metrics.active}>{numbers.format(model.metrics.active)}</dd>
            <dd className="text-sm text-text-secondary">{percentage.format(model.metrics.activePercent / 100)}</dd>
          </div>
          <div className="rounded border border-border bg-surface p-4" data-testid="flagged_inactive">
            <dt className="text-sm text-text-secondary">{windowLabel(labels.inactiveWindow)}</dt>
            <dd className="mt-2 text-2xl font-semibold text-text-primary" data-count={model.metrics.inactive}>{numbers.format(model.metrics.inactive)}</dd>
          </div>
          <div className="rounded border border-border bg-surface p-4" data-testid="no_data">
            <dt className="text-sm text-text-secondary">{labels.noData}</dt>
            <dd className="mt-2 text-2xl font-semibold text-text-primary" data-count={model.metrics.noData}>{numbers.format(model.metrics.noData)}</dd>
          </div>
        </dl>
      </section>
      <aside className="rounded border border-border bg-surface-alt p-4 text-text-secondary" data-testid="freshness_banner">
        <h2 className="font-semibold text-text-primary">{labels.freshnessTitle}</h2>
        <p className="mt-1 text-sm">{labels.freshnessLag}</p>
        <ul className="mt-2 space-y-1 text-sm">
          {model.freshness.map(account => <li key={account.accountId}>{`${account.accountName}: ${account.fallback ? labels.fallback : labels.confirmed} `}{date(account.dataThrough)}</li>)}
        </ul>
      </aside>
      <section className="overflow-x-auto rounded border border-border" data-testid="usage_table">
        <table className="w-full border-collapse text-sm">
          <caption className="p-4 text-left font-semibold text-text-primary">{labels.tableCaption}</caption>
          <thead className="bg-surface-alt text-left text-text-secondary"><tr>
            {[labels.person, labels.company, labels.lastKnownActivity, labels.daysInactive, labels.qualification, labels.license, labels.state, labels.dataThrough].map(header => <th className="p-3" key={header} scope="col">{header}</th>)}
          </tr></thead>
          <tbody className="text-text-primary">
            {model.rows.map(row => <tr className="border-t border-border" key={row.assignmentId} data-assignment-id={row.assignmentId}>
              <td className="p-3"><Link className="font-semibold text-primary underline" href={ROUTE_SCR_PERSON_DETAIL.replace(":personId", row.personId)}>{row.personName}</Link></td>
              <td className="p-3">{row.companyName}</td>
              <td className="p-3">{row.lastActivityDate === null ? labels.unknown : date(row.lastActivityDate)}</td>
              <td className="p-3 text-right font-mono">{row.daysInactive === null ? labels.unknown : numbers.format(row.daysInactive)}</td>
              <td className="p-3"><span className={badgeClass}>{row.classification === "no_data" ? labels.noData : row.classification === "inactive" ? labels.inactive : labels.active}</span><span className="ml-2 text-text-muted">{numbers.format(model.filters.window)}</span></td>
              <td className="p-3">{`${row.licenseTypeName} · ${row.vendorAccountName}`}</td>
              <td className="p-3"><span className={badgeClass}>{row.anchorState === null ? labels.anchorUnavailable : labels.states[row.anchorState]}</span></td>
              <td className="p-3">{date(row.dataThrough)}</td>
            </tr>)}
            {model.rows.length === 0 ? <tr><td className="p-6 text-center text-text-secondary" colSpan={8}>{labels.empty}</td></tr> : null}
          </tbody>
        </table>
      </section>
      {nextHref ? <nav aria-label={labels.next}><Link className="inline-flex min-h-11 items-center rounded border border-border px-4 text-primary underline" href={nextHref}>{labels.next}</Link></nav> : null}
    </main>
  );
}
