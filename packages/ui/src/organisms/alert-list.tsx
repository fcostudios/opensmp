import Link from "next/link";

export type AlertListFilter = "all" | "unacknowledged";

export interface AlertListItem {
  readonly acknowledgedAt: string | null;
  readonly acknowledgedBy: string | null;
  readonly firedAt: string;
  readonly href: string | null;
  readonly id: string;
  readonly notified: string;
  readonly scope: string;
  readonly subject: string;
  readonly type: string;
}

export interface AlertListLabels {
  readonly acknowledgedAt: string;
  readonly acknowledgedBy: string;
  readonly all: string;
  readonly emptyAll: string;
  readonly emptyUnacknowledged: string;
  readonly firedAt: string;
  readonly notified: string;
  readonly scope: string;
  readonly subject: string;
  readonly type: string;
  readonly unacknowledged: string;
}

export interface AlertListProps {
  readonly activeFilter: AlertListFilter;
  readonly allCount: string;
  readonly allHref: string;
  readonly items: readonly AlertListItem[];
  readonly labels: AlertListLabels;
  readonly locale: "en-US" | "es-EC";
  readonly unacknowledgedCount: string;
  readonly unacknowledgedHref: string;
}

function DateTime({
  locale,
  value,
}: {
  readonly locale: AlertListProps["locale"];
  readonly value: string;
}) {
  const date = new Date(value);
  return (
    <time dateTime={value}>
      {new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date)}
    </time>
  );
}

export function AlertList({
  activeFilter,
  allCount,
  allHref,
  items,
  labels,
  locale,
  unacknowledgedCount,
  unacknowledgedHref,
}: AlertListProps) {
  return (
    <section data-organism="alert-list">
      <nav aria-label={labels.type} className="flex flex-wrap gap-2">
        <Link
          aria-current={activeFilter === "unacknowledged" ? "page" : undefined}
          className="rounded border border-border px-3 py-2 text-sm font-semibold text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          data-testid="tab-sin-reconocer"
          href={unacknowledgedHref}
        >
          {labels.unacknowledged}{" "}
          <span className="font-mono text-xs text-text-muted">
            {unacknowledgedCount}
          </span>
        </Link>
        <Link
          aria-current={activeFilter === "all" ? "page" : undefined}
          className="rounded border border-border px-3 py-2 text-sm font-semibold text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          data-testid="tab-todas"
          href={allHref}
        >
          {labels.all}{" "}
          <span className="font-mono text-xs text-text-muted">
            {allCount}
          </span>
        </Link>
      </nav>

      <div
        className="mt-4 overflow-x-auto rounded border border-border bg-surface"
        data-testid="alerts_table"
      >
        <table className="w-full min-w-max border-collapse text-left">
          <thead>
            <tr className="border-b border-border text-sm text-text-secondary">
              <th className="px-3 py-2 font-medium" data-testid="fired_at" scope="col">
                {labels.firedAt}
              </th>
              <th className="px-3 py-2 font-medium" data-testid="type" scope="col">
                {labels.type}
              </th>
              <th className="px-3 py-2 font-medium" data-testid="scope" scope="col">
                {labels.scope}
              </th>
              <th className="px-3 py-2 font-medium" data-testid="subject_ref" scope="col">
                {labels.subject}
              </th>
              <th className="px-3 py-2 font-medium" data-testid="notified" scope="col">
                {labels.notified}
              </th>
              <th className="px-3 py-2 font-medium" data-testid="acknowledged_by" scope="col">
                {labels.acknowledgedBy}
              </th>
              <th className="px-3 py-2 font-medium" data-testid="acknowledged_at" scope="col">
                {labels.acknowledgedAt}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item) => (
              <tr key={item.id}>
                <td className="px-3 py-3 text-text-secondary">
                  <DateTime locale={locale} value={item.firedAt} />
                </td>
                <td className="px-3 py-3 font-semibold text-text-primary">
                  {item.type}
                </td>
                <td className="px-3 py-3 text-text-secondary">{item.scope}</td>
                <td className="px-3 py-3">
                  {item.href ? (
                    <Link
                      className="font-semibold text-text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      href={item.href}
                    >
                      {item.subject}
                    </Link>
                  ) : (
                    <span className="text-text-secondary">{item.subject}</span>
                  )}
                </td>
                <td className="px-3 py-3 text-text-secondary">{item.notified}</td>
                <td className="px-3 py-3 text-text-secondary">
                  {item.acknowledgedBy}
                </td>
                <td className="px-3 py-3 text-text-secondary">
                  {item.acknowledgedAt ? (
                    <DateTime locale={locale} value={item.acknowledgedAt} />
                  ) : null}
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td
                  className="px-4 py-10 text-center text-text-secondary"
                  colSpan={7}
                >
                  {activeFilter === "all"
                    ? labels.emptyAll
                    : labels.emptyUnacknowledged}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
