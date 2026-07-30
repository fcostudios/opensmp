import Link from "next/link";

import {
  REQUEST_STATUSES,
  StatusPill,
  type RequestStatus,
} from "@smp/ui";

import type { RequestListItem } from "@/modules/request-workflow/read-repository";

export interface RequestListLabels {
  readonly allStates: string;
  readonly company: string;
  readonly decided: string;
  readonly emptyDescription: string;
  readonly emptyTitle: string;
  readonly filters: string;
  readonly from: string;
  readonly licenseRequest: string;
  readonly neededBy: string;
  readonly newRequest: string;
  readonly state: string;
  readonly submitted: string;
  readonly tableTitle: string;
  readonly to: string;
}

export interface RequestListFilters {
  readonly state: string;
  readonly from: string;
  readonly to: string;
}

function ecuadorCalendarDate(instant: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Guayaquil",
    year: "numeric",
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function filterRequestList(
  items: readonly RequestListItem[],
  filters: RequestListFilters,
): readonly RequestListItem[] {
  return items.filter((item) => {
    const submittedDate = ecuadorCalendarDate(item.submittedAt);
    return (
      (!filters.state || item.state === filters.state) &&
      (!filters.from || submittedDate >= filters.from) &&
      (!filters.to || submittedDate <= filters.to)
    );
  });
}

function formatDate(
  value: string | null,
  locale: "es-EC" | "en-US",
): string {
  if (!value) return "—";
  const instant = value.includes("T")
    ? new Date(value)
    : new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: value.includes("T") ? "America/Guayaquil" : "UTC",
  }).format(instant);
}

export function RequestList({
  filters,
  items,
  labels,
  locale,
  statusLabels,
}: {
  readonly filters: RequestListFilters;
  readonly items: readonly RequestListItem[];
  readonly labels: RequestListLabels;
  readonly locale: "es-EC" | "en-US";
  readonly statusLabels: Readonly<Record<RequestStatus, string>>;
}) {
  return (
    <div className="space-y-4">
      <section
        className="flex flex-wrap items-center justify-end gap-3"
        data-testid="requests_actions"
      >
        <Link
          className="inline-flex min-h-11 items-center rounded bg-primary px-4 font-semibold text-text-on-primary hover:bg-primary-hover"
          data-testid="btn_new_request"
          href="/solicitudes/nueva"
        >
          {labels.newRequest}
        </Link>
      </section>

      <form
        className="grid gap-3 rounded-lg border border-border bg-surface p-4 md:grid-cols-[minmax(12rem,1fr)_minmax(10rem,0.7fr)_minmax(10rem,0.7fr)_auto]"
        data-testid="requests_filters"
        method="get"
      >
        <label className="grid gap-1 text-sm font-medium text-text-secondary">
          {labels.state}
          <select
            className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary"
            data-testid="filter_estado"
            defaultValue={filters.state}
            name="state"
          >
            <option value="">{labels.allStates}</option>
            {REQUEST_STATUSES.map((state) => (
              <option key={state} value={state}>
                {statusLabels[state]}
              </option>
            ))}
          </select>
        </label>
        <div
          className="grid grid-cols-2 gap-3 md:col-span-2"
          data-testid="filter_fecha"
        >
          <label className="grid gap-1 text-sm font-medium text-text-secondary">
            {labels.from}
            <input
              className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary"
              data-testid="filter_fecha_desde"
              defaultValue={filters.from}
              name="from"
              type="date"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium text-text-secondary">
            {labels.to}
            <input
              className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary"
              data-testid="filter_fecha_hasta"
              defaultValue={filters.to}
              name="to"
              type="date"
            />
          </label>
        </div>
        <button
          className="min-h-11 self-end rounded border border-border bg-surface-muted px-4 font-semibold text-text-primary"
          type="submit"
        >
          {labels.filters}
        </button>
      </form>

      <section
        className="overflow-hidden rounded-lg border border-border bg-surface"
        data-testid="requests_table"
      >
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-display text-xl font-semibold text-text-primary">
            {labels.tableTitle}
          </h2>
        </div>
        {items.length === 0 ? (
          <div
            className="grid justify-items-center gap-3 px-6 py-12 text-center"
            data-testid="requests_empty"
          >
            <h3 className="font-display text-xl font-semibold text-text-primary">
              {labels.emptyTitle}
            </h3>
            <p className="max-w-xl text-text-secondary">
              {labels.emptyDescription}
            </p>
            <Link
              className="inline-flex min-h-11 items-center rounded bg-primary px-4 font-semibold text-text-on-primary"
              data-testid="btn_empty_new_request"
              href="/solicitudes/nueva"
            >
              {labels.newRequest}
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[58rem] border-collapse text-left text-sm">
              <thead className="bg-surface-muted text-text-secondary">
                <tr>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    {labels.licenseRequest}
                  </th>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    {labels.company}
                  </th>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    {labels.state}
                  </th>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    {labels.submitted}
                  </th>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    {labels.decided}
                  </th>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    {labels.neededBy}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr className="border-t border-border" key={item.id}>
                    <th className="px-4 py-4 font-normal" scope="row">
                      <Link
                        className="font-semibold text-text-primary underline decoration-border underline-offset-4 hover:text-primary"
                        href={`/solicitudes/${item.id}`}
                      >
                        {item.personName} · {item.licenseTypeName}
                      </Link>
                      <p className="mt-1 font-mono text-xs text-text-muted">
                        {item.requestNo}
                      </p>
                    </th>
                    <td className="px-4 py-4 text-text-secondary">
                      {item.vendorAccountName}
                      <span className="block text-xs text-text-muted">
                        {item.companyName}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <StatusPill
                        label={statusLabels[item.state]}
                        status={item.state}
                      />
                    </td>
                    <td className="px-4 py-4 text-text-secondary">
                      {formatDate(item.submittedAt, locale)}
                    </td>
                    <td className="px-4 py-4 text-text-secondary">
                      {formatDate(item.decidedAt, locale)}
                    </td>
                    <td className="px-4 py-4 text-text-secondary">
                      {formatDate(item.neededBy, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
