import Link from "next/link";

export interface BlockedRequestItem {
  readonly companyName: string;
  readonly daysBlocked: number;
  readonly id: string;
  readonly licenseTypeName: string;
  readonly neededBy: string | null;
  readonly personName: string;
  readonly requestNo: string;
  readonly vendorAccountName: string;
}

export interface BlockedRequestsLabels {
  readonly company: string;
  readonly daysBlocked: string;
  readonly empty: string;
  readonly neededBy: string;
  readonly noDate: string;
  readonly organization: string;
  readonly request: string;
  readonly status: string;
  readonly statusBlocked: string;
  readonly viewPools: string;
}

function formatDate(
  value: string | null,
  locale: "en-US" | "es-EC",
  fallback: string,
): string {
  return value
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(
        new Date(`${value}T00:00:00.000Z`),
      )
    : fallback;
}

export function BlockedRequestsTable({
  items,
  labels,
  locale,
}: {
  readonly items: readonly BlockedRequestItem[];
  readonly labels: BlockedRequestsLabels;
  readonly locale: "en-US" | "es-EC";
}) {
  return (
    <div className="mt-5" data-testid="table_blocked">
      <div className="mb-3 flex justify-end">
        <Link
          className="rounded border border-border px-3 py-2 text-sm font-semibold text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          data-testid="btn_ver_cupos"
          href="/cupos"
        >
          {labels.viewPools}
        </Link>
      </div>
      <div className="overflow-x-auto rounded border border-border bg-surface">
        {items.length === 0 ? (
          <p className="p-8 text-center text-text-secondary">{labels.empty}</p>
        ) : (
          <table className="w-full min-w-max border-collapse text-left">
            <thead>
              <tr className="border-b border-border text-sm text-text-secondary">
                <th
                  className="px-3 py-2 font-medium"
                  data-testid="solicitud"
                  scope="col"
                >
                  {labels.request}
                </th>
                <th
                  className="px-3 py-2 font-medium"
                  data-testid="compania"
                  scope="col"
                >
                  {labels.company}
                </th>
                <th
                  className="px-3 py-2 font-medium"
                  data-testid="organizacion"
                  scope="col"
                >
                  {labels.organization}
                </th>
                <th
                  className="px-3 py-2 font-medium"
                  data-testid="dias_bloqueada"
                  scope="col"
                >
                  {labels.daysBlocked}
                </th>
                <th
                  className="px-3 py-2 font-medium"
                  data-testid="needed_by"
                  scope="col"
                >
                  {labels.neededBy}
                </th>
                <th
                  className="px-3 py-2 font-medium"
                  data-testid="estado"
                  scope="col"
                >
                  {labels.status}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((request) => (
                <tr key={request.id}>
                  <td className="px-3 py-3">
                    <Link
                      className="font-semibold text-text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      href={`/solicitudes/${request.id}`}
                    >
                      {request.personName} · {request.licenseTypeName}
                    </Link>
                    <span className="mt-1 block font-mono text-xs text-text-muted">
                      {request.requestNo}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-text-secondary">
                    {request.companyName}
                  </td>
                  <td className="px-3 py-3 text-text-secondary">
                    {request.vendorAccountName}
                  </td>
                  <td className="px-3 py-3 font-mono text-text-secondary">
                    {request.daysBlocked}
                  </td>
                  <td className="px-3 py-3 text-text-secondary">
                    {formatDate(request.neededBy, locale, labels.noDate)}
                  </td>
                  <td className="px-3 py-3 font-semibold text-text-primary">
                    {labels.statusBlocked}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
