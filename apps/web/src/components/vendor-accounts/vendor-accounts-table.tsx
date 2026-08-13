import Link from "next/link";

import { ROUTE_SCR_VENDOR_ACCOUNTS } from "@/lib/routes";
import type { VendorAccountListItem } from "@/modules/vendor-catalog/vendor-account-repository";

export interface VendorAccountsTableLabels {
  readonly columns: {
    readonly connector: string;
    readonly credential: string;
    readonly floor: string;
    readonly mode: string;
    readonly name: string;
    readonly renewal: string;
    readonly seats: string;
    readonly status: string;
    readonly vendor: string;
  };
  readonly connector: Record<VendorAccountListItem["connectorType"], string>;
  readonly credential: Record<NonNullable<VendorAccountListItem["credentialHealth"]> | "none", string>;
  readonly empty: string;
  readonly modes: Record<VendorAccountListItem["mode"], string>;
  readonly noRenewal: string;
  readonly protocol: Record<VendorAccountListItem["provisioningProtocol"], string>;
  readonly seatsPattern: string;
  readonly status: Record<VendorAccountListItem["status"], string>;
  readonly tableCaption: string;
  readonly viewAccount: string;
}

function date(value: string | null, locale: string, fallback: string): string {
  if (!value) return fallback;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00.000Z`),
  );
}

export function VendorAccountsTable({ accounts, labels, locale }: {
  readonly accounts: readonly VendorAccountListItem[];
  readonly labels: VendorAccountsTableLabels;
  readonly locale: string;
}) {
  if (accounts.length === 0) {
    return <p className="rounded border border-border bg-surface p-8 text-center text-text-secondary">{labels.empty}</p>;
  }
  const columns = [
    labels.columns.name,
    labels.columns.vendor,
    labels.columns.connector,
    labels.columns.mode,
    labels.columns.seats,
    labels.columns.renewal,
    labels.columns.credential,
    labels.columns.floor,
    labels.columns.status,
  ];
  return (
    <div className="overflow-x-auto rounded border border-border bg-surface">
      <table className="w-full min-w-max border-collapse text-left">
        <caption className="sr-only">{labels.tableCaption}</caption>
        <thead>
          <tr className="border-b border-border text-sm text-text-secondary">
            {columns.map((label) => <th className="px-3 py-2 font-medium" key={label} scope="col">{label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {accounts.map((account) => (
            <tr key={account.id}>
              <td className="px-3 py-3">
                <Link
                  className="inline-flex min-h-11 items-center font-semibold text-text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  href={`${ROUTE_SCR_VENDOR_ACCOUNTS}/${encodeURIComponent(account.id)}`}
                  title={labels.viewAccount}
                >
                  {account.name}
                </Link>
              </td>
              <td className="px-3 py-3 text-text-secondary">{account.vendorName}</td>
              <td className="px-3 py-3 text-text-secondary">{labels.connector[account.connectorType]} · {labels.protocol[account.provisioningProtocol]}</td>
              <td className="px-3 py-3 text-text-secondary">{labels.modes[account.mode]}</td>
              <td className="px-3 py-3 font-mono text-text-secondary">{labels.seatsPattern.replace("{purchased}", String(account.purchased)).replace("{free}", String(account.free))}</td>
              <td className="px-3 py-3 text-text-secondary">{date(account.contractRenewalOn, locale, labels.noRenewal)}</td>
              <td className="px-3 py-3 text-text-secondary">{labels.credential[account.credentialHealth ?? "none"]}</td>
              <td className="px-3 py-3 font-mono text-text-secondary">{account.lowPoolFloor}</td>
              <td className="px-3 py-3"><span className={account.status === "active" ? "rounded-full bg-success-bg px-2 py-1 text-xs font-semibold text-success-text" : "rounded-full bg-neutral-bg px-2 py-1 text-xs font-semibold text-neutral-text"}>{labels.status[account.status]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
