import Link from "next/link";

export interface OverdueInvitesLabels {
  readonly request: string;
  readonly ageHours: string;
  readonly empty: string;
}

export function OverdueInvitesTable({ items, labels, locale }: {
  readonly items: readonly {
    readonly requestId: string;
    readonly requestNo: string;
    readonly ageHours: number;
  }[];
  readonly labels: OverdueInvitesLabels;
  readonly locale: "en-US" | "es-EC";
}) {
  return (
    <div className="mt-5 overflow-x-auto rounded border border-border bg-surface" data-testid="table_expired_invites">
      {items.length === 0 ? (
        <p className="p-8 text-center text-text-secondary">{labels.empty}</p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border text-sm text-text-secondary">
              <th className="px-3 py-2 font-medium" scope="col">{labels.request}</th>
              <th className="px-3 py-2 font-medium" scope="col">{labels.ageHours}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item) => (
              <tr key={item.requestId}>
                <td className="px-3 py-3">
                  <Link
                    className="font-semibold text-text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    href={`/solicitudes/${item.requestId}`}
                  >
                    {item.requestNo}
                  </Link>
                </td>
                <td className="px-3 py-3 font-mono text-text-secondary">
                  {new Intl.NumberFormat(locale).format(item.ageHours)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
