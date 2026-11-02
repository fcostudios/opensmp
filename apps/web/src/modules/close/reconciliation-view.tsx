"use client";
import { useActionState, useState, type ReactNode } from "react";
import type { ReconciliationAction, ReconciliationState } from "@smp/contracts/reconciliation";
import { varianceCauses, money as moneySchema } from "@smp/contracts/reconciliation";
import { compareInvoice } from "@smp/domain/close/reconciliation";
import type { ReconciliationCard } from "./reconciliation-transaction";
import { useLocale } from "@/lib/i18n/use-locale";
import type messages from "@/lib/i18n/en-US.json";
import { ROUTE_SCR_CLOSE, ROUTE_SCR_RATES } from "@/lib/routes";
type Actions = { saveInvoiceAmount: ReconciliationAction; overrideReconciliation: ReconciliationAction; saveVarianceLine: ReconciliationAction; deleteVarianceLine: ReconciliationAction };
type Copy = typeof messages.reconciliation;
const money = (value: string) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value));
function KeyFields({period, card}: {period: string; card: ReconciliationCard}) {
  return <><input type="hidden" name="period" value={period}/><input type="hidden" name="vendorAccountId" value={card.vendorAccountId}/></>;
}
function Result({state,t}: {state: ReconciliationState; t: Copy}) {
  if (state.status === "error") return <p role="alert">{t.error}</p>;
  if (state.status !== "idle") return <p role="status">{t[state.status]}</p>;
  return null;
}
function LineForm({period,card,line,action,remove,t}: {period:string;card:ReconciliationCard;line?:ReconciliationCard["lines"][number];action:ReconciliationAction;remove:ReconciliationAction;t:Copy}) {
  const [state,save,pending]=useActionState(action,{status:"idle" as const});
  const [deleted,deleteAction,deleting]=useActionState(remove,{status:"idle" as const});
  if(deleted.status === "saved") return <p role="status">{t.saved}</p>;
  return <div className="space-y-2 rounded border border-border p-4">
    <form action={save} className="space-y-2">
      <KeyFields period={period} card={card}/>{line && <input type="hidden" name="lineId" value={line.id}/>}
      <fieldset disabled={pending || deleting} className="grid gap-2 md:grid-cols-2">
        <label>{t.cause}<select name="cause" defaultValue={line?.cause ?? "other"}>{varianceCauses.map(cause=><option key={cause} value={cause}>{t.causes[cause]}</option>)}</select></label>
        <label>{t.detail}<textarea name="detail" required maxLength={2000} defaultValue={line?.detail}/></label>
        {/* @equivalent: an invalid string default in a number input is sanitized to the same empty value. */}
        <label>{t.registerAmount}<input name="registerAmountUsd" type="number" step="0.01" min="0" required defaultValue={line?.registerAmountUsd ?? ""}/></label>
        {/* @equivalent: an invalid string default in a number input is sanitized to the same empty value. */}
        <label>{t.lineInvoiceAmount}<input name="invoiceAmountUsd" type="number" step="0.01" min="0" required defaultValue={line?.invoiceAmountUsd ?? ""}/></label>
        <label>{t.evidenceUrl}<input name="evidenceUrl" type="url" maxLength={2000} defaultValue={line?.evidenceUrl ?? ""}/></label>
        <button type="submit" className="rounded bg-primary px-4 py-2 text-white">{pending ? t.pending : t.saveLine}</button>
      </fieldset><Result state={state} t={t}/>
    </form>
    {line && <form action={deleteAction}><KeyFields period={period} card={card}/><input type="hidden" name="lineId" value={line.id}/><button type="submit" disabled={deleting || pending} className="rounded border border-border px-4 py-2">{deleting ? t.pending : t.deleteLine}</button><Result state={deleted} t={t}/></form>}
  </div>;
}
function OrgCard({period,card,actions,t}: {period:string;card:ReconciliationCard;actions:Actions;t:Copy}) {
  const [state,save,pending]=useActionState(actions.saveInvoiceAmount,{status:"idle" as const});
  const [override,approve,approving]=useActionState(actions.overrideReconciliation,{status:"idle" as const});
  const [dialog,setDialog]=useState(false);
  // @equivalent: an invalid string fallback renders the same empty number input and fails the same money validation until edited.
  const [invoice,setInvoice]=useState(card.invoiceAmountUsd ?? "");
  const closed=card.status !== "open" || state.status === "reconciled" || override.status === "overridden";
  const comparison=moneySchema.safeParse(invoice).success ? compareInvoice(card.rollupAmountUsd,invoice) : null;
  return <article data-testid="recon_card" className="space-y-4 rounded-lg border border-border p-4">
    <h2 className="text-xl font-semibold">{card.name}</h2><p>{t[card.status]}</p>
    <dl><dt>{t.rollup}</dt><dd className="font-mono">{money(card.rollupAmountUsd)}</dd></dl>
    <form action={save} className="space-y-2"><KeyFields period={period} card={card}/>
      <label>{t.invoice}<input data-testid="invoice_amount_usd" type="number" step="0.01" min="0" required name="invoiceAmountUsd" value={invoice} onChange={event=>setInvoice(event.target.value)} readOnly={closed} disabled={pending}/></label>
      {!closed && <button type="submit" disabled={pending} className="rounded bg-primary px-4 py-2 text-white">{pending ? t.pending : t.saveInvoice}</button>}
      <Result state={state} t={t}/>
    </form>
    <div data-testid="variance_usd" className={comparison === null ? "text-text-secondary" : comparison.withinTolerance ? "text-success" : "text-error-text"}>
      <p>{comparison === null ? t.noInvoice : comparison.withinTolerance ? t.within : t.outside}</p>
      {comparison && <p className="font-mono">{t.variance}: {money(comparison.varianceUsd)}</p>}
    </div>
    {!closed && card.invoiceAmountUsd === invoice && comparison && !comparison.withinTolerance && <button type="button" onClick={()=>setDialog(true)} className="rounded border border-border px-4 py-2">{t.override}</button>}
    {dialog && !closed && <dialog open aria-label={t.override} data-testid="modal_override" className="rounded border border-border bg-surface p-6">
      <form action={approve} className="space-y-4"><KeyFields period={period} card={card}/><p>{card.name} · {period}</p>
        <label>{t.note}<textarea data-testid="override_note" name="note" required maxLength={2000} disabled={approving}/></label>
        <button type="submit" disabled={approving} className="rounded bg-primary px-4 py-2 text-white">{approving ? t.pending : t.confirmOverride}</button>
        <button type="button" disabled={approving} onClick={()=>setDialog(false)}>{t.cancel}</button><Result state={override} t={t}/>
      </form></dialog>}
    {override.status === "overridden" && <Result state={override} t={t}/>}
    {card.overrideNote && <p>{t.overrideRecorded}: {card.overrideNote}</p>}
    <section data-testid="variance_table" className="space-y-2"><h3 className="font-semibold">{t.lines}</h3>
      {card.lines.map(line=><div key={line.id}>
        <p>{t.causes[line.cause]} · {line.detail}</p>
        <p className="font-mono">{t.registerAmount}: {line.registerAmountUsd === null ? "—" : money(line.registerAmountUsd)} · {t.lineInvoiceAmount}: {line.invoiceAmountUsd === null ? "—" : money(line.invoiceAmountUsd)} · {t.difference}: {money(line.differenceUsd)}</p>
        {line.evidenceUrl && <a href={line.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">{t.evidence}</a>}
        {!closed && <LineForm period={period} card={card} line={line} action={actions.saveVarianceLine} remove={actions.deleteVarianceLine} t={t}/>}
      </div>)}
      {!closed && <details><summary>{t.addLine}</summary><LineForm period={period} card={card} action={actions.saveVarianceLine} remove={actions.deleteVarianceLine} t={t}/></details>}
    </section>
  </article>;
}
export function ReconciliationView({period,cards,actions,children}: {period:string;cards:readonly ReconciliationCard[];actions:Actions;children?:ReactNode}) {
  const {t:dictionary}=useLocale();const t=dictionary.reconciliation as Copy;
  return <div className="space-y-6 p-6 [&_input:not([type=hidden])]:rounded [&_input:not([type=hidden])]:border [&_input:not([type=hidden])]:border-border [&_input:not([type=hidden])]:bg-surface [&_input:not([type=hidden])]:p-2 [&_textarea]:w-full [&_textarea]:rounded [&_textarea]:border [&_textarea]:border-border [&_textarea]:p-2 [&_select]:rounded [&_select]:border [&_select]:border-border [&_select]:p-2 [&_label]:grid [&_label]:gap-1">
    <header><h1 className="text-2xl font-bold">{t.title}</h1><p>{t.subtitle}</p></header>
    <nav data-testid="recon_actions" className="flex gap-4"><a href={ROUTE_SCR_CLOSE}>{t.back}</a><a href={ROUTE_SCR_RATES}>{t.rates}</a></nav>
    <form method="get"><label>{t.period}<input type="month" name="period" defaultValue={period} required/></label><input type="submit" value={t.choosePeriod}/></form>
    <p data-testid="tolerance_note">{t.tolerance}</p><p>{t.immutable}</p>{children}
    {cards.length === 0 && <p>{t.empty}</p>}
    <section data-testid="recon_cards" className="grid gap-4 lg:grid-cols-3">{cards.map(card=><OrgCard key={`${card.vendorAccountId}:${card.invoiceAmountUsd}:${card.status}`} period={period} card={card} actions={actions} t={t}/>)}</section>
  </div>;
}
