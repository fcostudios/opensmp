"use client";
import { useActionState, useState } from "react";
import type { FinalizeAction, StatementSummary } from "./finalization-panel-types";
import { useLocale } from "@/lib/i18n/use-locale";
import type messages from "@/lib/i18n/en-US.json";

function ConfirmationForm({ period, statementId, action }: { period: string; statementId?: string; action: FinalizeAction }) {
  const { t: dictionary } = useLocale();
  const t = dictionary.finalization as typeof messages.finalization;
  const [confirmed, setConfirmed] = useState(false);
  // @equivalent: an empty initial state/status also renders no result; actions ignore previous state.
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  return <form action={formAction} className="space-y-2">
    <input type="hidden" name="period" value={period} />
    {statementId && <input type="hidden" name="statementId" value={statementId} />}
    <label className="flex items-center gap-2"><input type="checkbox" name="confirmed" value="true" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={pending} />{t.confirm}</label>
    <button type="submit" disabled={!confirmed || pending} className="rounded bg-primary px-4 py-2 text-white disabled:opacity-50">{pending ? t.pending : statementId ? t.single : t.period}</button>
    {state.status === "error" && <p role="alert">{t.error}</p>}
    {state.status === "finalized" && <p role="status">{t.success}: {state.count}</p>}
  </form>;
}
export function FinalizationPanel({ period, statements, singleAction, periodAction }: {
  period: string; statements: readonly StatementSummary[]; singleAction: FinalizeAction; periodAction: FinalizeAction;
}) {
  const { t: dictionary } = useLocale();
  const t = dictionary.finalization as typeof messages.finalization;
  return <section className="space-y-4 p-6" aria-label={t.title}>
    <h2 className="text-xl font-semibold">{t.title} · {period}</h2>
    <p>{t.immutable}</p>
    {statements.some(row => row.status === "draft") && <ConfirmationForm period={period} action={periodAction} />}
    {statements.length === 0 && <p>{t.empty}</p>}
    {statements.map(row => <article key={row.id} className="space-y-2 rounded-lg border border-border p-4">
      <h3 className="font-semibold">{row.companyName}</h3>
      <span className="inline-block rounded border border-border px-2 py-1">{t[row.status]}</span>
      {row.status === "draft" && <ConfirmationForm period={period} statementId={row.id} action={singleAction} />}
    </article>)}
  </section>;
}
