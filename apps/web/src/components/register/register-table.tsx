"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { DataTable, RegisterDrilldown } from "@smp/ui";

import type { RegisterRow } from "@/modules/register/repository";

interface RegisterTableLabels {
  readonly companyCode: string;
  readonly company: string;
  readonly drilldownClose: string;
  readonly drilldownDecisionDate: string;
  readonly drilldownSource: string;
  readonly drilldownStatementLines: string;
  readonly drilldownTitle: string;
  readonly empty: string;
  readonly endReason: string;
  readonly endReasonInactive: string;
  readonly endReasonLeftCompany: string;
  readonly endReasonReallocated: string;
  readonly endedOn: string;
  readonly licenseType: string;
  readonly organization: string;
  readonly person: string;
  readonly requestApproved: string;
  readonly requestPending: string;
  readonly requestRejected: string;
  readonly note: string;
  readonly source: string;
  readonly sourceImport: string;
  readonly sourceReconciliation: string;
  readonly sourceRequest: string;
  readonly startedOn: string;
  readonly tableCaption: string;
  readonly viewStatement?: string;
}

export interface RegisterTableProps {
  readonly canViewRequests: boolean;
  readonly canViewStatements: boolean;
  readonly items: readonly RegisterRow[];
  readonly labels: RegisterTableLabels;
  readonly locale: string;
}

function sourceLabel(row: RegisterRow, labels: RegisterTableLabels): string {
  if (row.sourceRequestNo) return `${labels.sourceRequest} ${row.sourceRequestNo}`;
  return row.sourceKind === "import" ? labels.sourceImport : labels.sourceReconciliation;
}

export function RegisterTable({ canViewRequests, canViewStatements, items, labels, locale }: RegisterTableProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const returnFocusRef = useRef<HTMLTableRowElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeZone: "UTC" });
  const endReason = (value: RegisterRow["endReason"]) => {
    if (value === "inactive") return labels.endReasonInactive;
    if (value === "left_company") return labels.endReasonLeftCompany;
    if (value === "reallocated") return labels.endReasonReallocated;
    return "—";
  };
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selected && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>("button")?.focus();
    }
    if (!selected && dialog.open) dialog.close();
  }, [selected]);

  return (
    <section className="rounded border border-border bg-surface" data-testid="register_table">
      <DataTable
        caption={labels.tableCaption}
        columns={[
          { id: "person", label: labels.person }, { id: "company", label: labels.companyCode },
          { id: "vendor", label: labels.organization }, { id: "license", label: labels.licenseType },
          { id: "start", label: labels.startedOn }, { id: "end", label: labels.endedOn },
          { id: "reason", label: labels.endReason }, { id: "source", label: labels.source },
        ]}
        emptyLabel={labels.empty}
        onRowClick={(id, trigger) => { returnFocusRef.current = trigger; setSelectedId(id); }}
        rows={items.map((row) => ({
          id: row.id,
          cells: {
            person: row.personName,
            company: row.companyCode,
            vendor: row.vendorAccountName,
            license: row.licenseTypeName,
            start: dateFormatter.format(new Date(`${row.startedOn}T00:00:00.000Z`)),
            end: row.endedOn ? dateFormatter.format(new Date(`${row.endedOn}T00:00:00.000Z`)) : "—",
            reason: <span className="rounded border border-border px-2 py-1 text-xs">{endReason(row.endReason)}</span>,
            source: <div className="grid gap-1">
              {row.sourceRequestId && canViewRequests ? (
                <Link className="text-primary underline" href={`/solicitudes/${row.sourceRequestId}`} onClick={(event) => event.stopPropagation()}>{sourceLabel(row, labels)}</Link>
              ) : row.sourceRequestId ? (
                <button
                  className="text-left text-primary underline"
                  onClick={(event) => {
                    event.stopPropagation();
                    returnFocusRef.current = event.currentTarget.closest("tr");
                    setSelectedId(row.id);
                  }}
                  type="button"
                >
                  {sourceLabel(row, labels)}
                </button>
              ) : sourceLabel(row, labels)}
              {row.note ? <span className="text-xs text-text-muted">{labels.note}: {row.note}</span> : null}
            </div>,
          },
        }))}
      />
      {selected ? (
        <dialog aria-labelledby="register-drilldown-title" className="max-h-[90vh] w-[min(56rem,calc(100%-2rem))] rounded border border-border bg-surface p-5 text-text-primary backdrop:bg-overlay" data-testid="modal_assignment_trace" onCancel={(event) => { event.preventDefault(); setSelectedId(null); queueMicrotask(() => returnFocusRef.current?.focus()); }} onKeyDown={(event) => { if (event.key !== "Tab") return; const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),[tabindex]:not([tabindex='-1'])")); if (nodes.length < 2) return; const index = nodes.indexOf(document.activeElement as HTMLElement); if ((!event.shiftKey && index === nodes.length - 1) || (event.shiftKey && index <= 0)) { event.preventDefault(); nodes[event.shiftKey ? nodes.length - 1 : 0]?.focus(); } }} ref={dialogRef}>
          <div className="max-h-full overflow-y-auto">
            <RegisterDrilldown assignment={selected} canViewStatements={canViewStatements} labels={labels} locale={locale} />
            <div className="mt-5 flex justify-end">
              <button className="min-h-11 rounded border border-border px-4" onClick={() => { const trigger = returnFocusRef.current; setSelectedId(null); queueMicrotask(() => trigger?.focus()); }} type="button">{labels.drilldownClose}</button>
            </div>
          </div>
        </dialog>
      ) : null}
    </section>
  );
}
