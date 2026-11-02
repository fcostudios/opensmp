"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import type messages from "@/lib/i18n/en-US.json";
import { useLocale } from "@/lib/i18n/use-locale";
import { formatUsd } from "@smp/ui";
import { ROUTE_SCR_POOLS } from "@/lib/routes";
import type { RatesWorkspace } from "./rate-service";

import type { RateActionState, RateAction } from "./rates-action-types";
type Row = RatesWorkspace["rates"][number];
export function RatesView({ data, action }: { data: RatesWorkspace; action: RateAction }) {
  const { t: dictionary } = useLocale();
  const t = dictionary.rates as typeof messages.rates;
  const [editing, setEditing] = useState<Row | null>(null);
  return <div className="space-y-6 p-6">
    <header><h1 className="text-2xl font-bold">{t.title}</h1><p>{t.subtitle}</p></header>
    <p data-testid="proration_note" className="rounded-lg border border-border p-4">{t.proration}</p>
    <p className="text-text-secondary">{t.provisionalNote}</p>
    <div className="grid gap-6 xl:grid-cols-2" data-testid="rates_tabs">
      <section data-testid="tab_tarifas" className="min-w-0 space-y-4">
        <h2 className="text-lg font-semibold">{t.ratesTitle}</h2>
        <div className="overflow-x-auto"><table data-testid="rates_table" className="w-full text-left text-sm">
          <thead><tr>{[t.account, t.license, t.amount, t.from, t.to, t.status, t.lock].map(label => <th key={label} className="p-2">{label}</th>)}<th /></tr></thead>
          <tbody>{data.rates.map(row => <tr key={row.id} className="border-t border-border">
            <td className="p-2">{row.accountName}</td><td>{row.licenseName}</td>
            <td>{formatUsd(Number(row.monthlyRateUsd), "en-US")}</td>
            <td>{row.effectiveFrom}</td><td>{row.effectiveTo ?? t.open}</td>
            <td>{row.provisional ? t.provisional : t.contracted}</td><td>{row.locked ? t.locked : t.editable}</td>
            <td>{!row.locked && <button type="button" onClick={() => setEditing(row)}>{t.edit}</button>}</td>
          </tr>)}</tbody>
        </table></div>
        {data.rates.length === 0 && <p>{t.emptyRates}</p>}
      </section>
      <section data-testid="tab_capacidad" className="min-w-0 space-y-4">
        <h2 className="text-lg font-semibold">{t.capacityTitle}</h2>
        <div className="overflow-x-auto"><table data-testid="capacity_table" className="w-full text-left text-sm">
          <thead><tr>{[t.account, t.license, t.quantity, t.from, t.note].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
          <tbody>{data.capacity.map(row => <tr key={row.id} className="border-t border-border"><td className="p-2">{row.accountName}</td><td>{row.licenseName}</td><td>{row.purchasedQty}</td><td>{row.effectiveFrom}</td><td>{row.note}</td></tr>)}</tbody>
        </table></div>
        {data.capacity.length === 0 && <p>{t.emptyCapacity}</p>}
        <Link href={ROUTE_SCR_POOLS}>{t.capacityLink}</Link>
      </section>
    </div>
    {/* @equivalent: changing only the new-form key label to empty preserves distinct UUID editing keys and every remount. */}
    <RateForm key={editing?.id ?? "new"} data={data} action={action} editing={editing} />
    {editing && <button type="button" onClick={() => setEditing(null)}>{t.cancel}</button>}
  </div>;
}
function RateForm({ data, action, editing }: { data: RatesWorkspace; action: RateAction; editing: Row | null }) {
  const { t: dictionary } = useLocale();
  const t = dictionary.rates as typeof messages.rates;
  // @equivalent: empty initial object/status also renders neither result; the production action ignores previousState.
  const [state, formAction, pending] = useActionState<RateActionState, FormData>(action, { status: "idle" });
  // @equivalent: a non-option fallback string displays/submits the blank select and finds no vendor, exactly like empty.
  const [accountId, setAccountId] = useState(editing?.vendorAccountId ?? "");
  const vendorId = data.accounts.find(account => account.id === accountId)?.vendorId;
  return <form action={formAction} data-testid="modal_add_rate" className="space-y-4 rounded-lg border border-border p-4">
    <h2 className="text-lg font-semibold">{editing ? t.edit : t.add}</h2>
    {editing && <input type="hidden" name="id" value={editing.id} />}
    <label className="block">{t.account}<select aria-label={t.account} name="vendorAccountId" required value={accountId} disabled={!!editing} onChange={event => setAccountId(event.target.value)} className="block rounded border border-border p-2">
      <option value="">{t.choose}</option>{data.accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
    </select></label>
    {editing && <input type="hidden" name="vendorAccountId" value={editing.vendorAccountId} />}
    {/* @equivalent: a non-option fallback default normalizes to the same first blank option and submitted value. */}
    <label className="block">{t.license}<select aria-label={t.license} name="licenseTypeId" required defaultValue={editing?.licenseTypeId ?? ""} disabled={!!editing} className="block rounded border border-border p-2">
      <option value="">{t.choose}</option>{data.licenses.filter(license => license.vendorId === vendorId).map(license => <option key={license.id} value={license.id}>{license.name}</option>)}
    </select></label>
    {editing && <input type="hidden" name="licenseTypeId" value={editing.licenseTypeId} />}
    <label className="block">{t.amount}<input aria-label={t.amount} name="monthlyRateUsd" type="number" min="0" max="99999999.99" step="0.01" required defaultValue={editing?.monthlyRateUsd} className="block rounded border border-border p-2" /></label>
    <label className="block">{t.from}<input aria-label={t.from} name="effectiveFrom" type="date" required defaultValue={editing?.effectiveFrom} className="block rounded border border-border p-2" /></label>
    {/* @equivalent: an invalid non-date fallback normalizes to the same empty date value and submitted value. */}
    <label className="block">{t.to}<input aria-label={t.to} name="effectiveTo" type="date" defaultValue={editing?.effectiveTo ?? ""} className="block rounded border border-border p-2" /></label>
    <label className="block"><input name="provisional" type="checkbox" defaultChecked={editing?.provisional ?? true} />{t.provisionalLabel}</label>
    <button data-testid="btn_save_rate" type="submit" disabled={pending} className="rounded bg-primary px-4 py-2 text-white">{pending ? t.saving : t.save}</button>
    {state.status === "error" && <p role="alert">{t.error}</p>}
    {state.status === "success" && <p role="status">{t.saved}</p>}
  </form>;
}
