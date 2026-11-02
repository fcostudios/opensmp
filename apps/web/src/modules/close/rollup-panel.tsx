"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { ROUTE_SCR_RECONCILIATION } from "@/lib/routes";
import type messages from "../../../messages/en-US.json";

type Download = { csv: string; filename: string };
export function RollupPanel({ period, reconciliationTotalUsd, ties, action, t }: {
  period: string; reconciliationTotalUsd: string; ties: boolean;
  action: (period: string) => Promise<Download>; t: typeof messages.rollup;
}) {
  const [download, setDownload] = useState<Download | null>(null);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  function exportCsv() {
    setDownload(null);
    setError(false);
    startTransition(async () => {
      try { setDownload(await action(period)); } catch { setError(true); }
    });
  }
  return <section data-testid="rollup_panel" className="space-y-4 rounded-lg border border-border p-4">
    <h2 className="font-semibold">{t.title}{" · "}{period}</h2>
    <dl data-testid="rollup_reconciliation_total"><dt>{t.total}</dt><dd className="font-mono">{reconciliationTotalUsd}</dd></dl>
    <p role="status">{ties ? t.tied : t.untied}</p>
    <Link className="block underline" href={`${ROUTE_SCR_RECONCILIATION}?period=${period}`}>{t.reconciliation}</Link>
    <button data-testid="btn_export_rollup_csv" type="button" onClick={exportCsv} disabled={pending} className="rounded border border-border px-4 py-2">{pending ? t.pending : t.csv}</button>
    {error && <p role="alert">{t.error}</p>}
    {download && <a className="block underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(download.csv)}`} download={download.filename}>{t.download}</a>}
  </section>;
}
