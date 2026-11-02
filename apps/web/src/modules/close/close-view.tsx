"use client";
import { useActionState, type ReactNode } from "react";
import Link from "next/link";
import type { CloseRunView, CloseAction, CloseSummary } from "./close-view-types";
import { ROUTE_SCR_CLOSE } from "@/lib/routes";
import { useLocale } from "@/lib/i18n/use-locale";
import type messages from "@/lib/i18n/en-US.json";
export function CloseView({ period, latest, action, summary, tiles }: { period: string; latest: CloseRunView | null; action: CloseAction; summary?: CloseSummary; tiles?: ReactNode }) {
  const { t: dictionary } = useLocale();
  const t = dictionary.close as typeof messages.close;
  // @equivalent: an empty initial state/status also renders no result; the server action ignores previous state.
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const durationMs = latest?.finishedAt ? latest.finishedAt.valueOf() - latest.startedAt.valueOf() : null;
  const nfr = latest?.status === "succeeded" && durationMs !== null
    ? durationMs < 300_000 ? t.withinTarget : t.overTarget
    : latest ? t[latest.status] : t.noRun;
  return <div className="space-y-6 p-6">
    <header><h1 className="text-2xl font-bold">{t.title}</h1><p>{t.subtitle}</p></header>
    <p data-testid="close_progress_note" className="rounded-lg border border-border p-4">{t.licenseOnly}</p>
    <form action={ROUTE_SCR_CLOSE} method="get" className="flex items-end gap-4">
      <label>{t.period}<input aria-label={t.period} name="period" type="month" defaultValue={period} required className="block rounded border border-border p-2" /></label>
      <button type="submit" className="rounded border border-border px-4 py-2">{t.select}</button>
    </form>
    {tiles ?? <section data-testid="close_tiles" className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {[
        ["tile_current_period", t.period, period],
        ["tile_statements_generated", t.generated, summary ? `${summary.generated}/${summary.companies}` : t.unavailable],
        ["tile_drafts", t.drafts, summary?.drafts ?? t.unavailable],
        ["tile_finals", t.finals, summary?.finals ?? t.unavailable],
        ["tile_group_total", t.total, summary ? `USD ${summary.totalUsd}` : t.unavailable],
      ].map(([id,label,value])=><div key={id} data-testid={id} className="rounded-lg border border-border p-4"><h2>{label}</h2><p className="text-2xl font-semibold">{value}</p></div>)}
    </section>}
    <section data-testid="latest_close_run" className="space-y-2 rounded-lg border border-border p-4">
      <h2 className="font-semibold">{t.latest}</h2><p>{period}</p>
      {latest ? <><p>{t[latest.status]}</p><p>{latest.id}</p><time dateTime={latest.startedAt.toISOString()}>{latest.startedAt.toLocaleString("en-US", { timeZone: "America/Guayaquil" })}</time>
        <p>{t.by} {latest.scheduled ? t.scheduled : latest.triggeredByName ?? t.unknownActor}</p>
        <p>{t.duration}: {latest.finishedAt ? (latest.finishedAt.valueOf() - latest.startedAt.valueOf()) / 1000 : t.running} {t.seconds}</p>
        <p data-testid="close_nfr">{t.duration}: {nfr}</p>
        {latest.note && <p className="whitespace-pre-wrap">{latest.note}</p>}</> : <p>{t.noRun}</p>}
    </section>
    <form action={formAction} data-testid="modal_confirm_close" className="space-y-4 rounded-lg border border-border p-4">
      <h2 className="font-semibold">{t.run} · {period}</h2>
      <input type="hidden" name="period" value={period} />
      <label className="block">{t.note}<textarea data-testid="confirm_note" aria-label={t.note} name="note" maxLength={2000} className="block w-full rounded border border-border p-2" /></label>
      <p>{t.confirm}</p><button data-testid="btn_confirm_run_close" type="submit" disabled={pending} className="rounded bg-primary px-4 py-2 text-white">{pending ? t.running : t.run}</button>
      {state.status === "error" && <p role="alert">{t.error}</p>}
      {(state.status === "succeeded" || state.status === "failed") && <p role={state.status === "failed" ? "alert" : "status"}>{t[state.status]} · {state.runId} · {state.durationMs / 1000} {t.seconds}</p>}
    </form>
    <Link href={`${ROUTE_SCR_CLOSE}?period=${period}`}>{t.refresh}</Link>
  </div>;
}
