"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

interface Choices {
  readonly companies: readonly { readonly id: string; readonly label: string }[];
  readonly people: readonly { readonly id: string; readonly label: string; readonly companyId: string }[];
  readonly accounts: readonly { readonly id: string; readonly label: string; readonly vendorId: string }[];
  readonly licenses: readonly { readonly id: string; readonly label: string; readonly vendorId: string }[];
}

interface ManualRegisterFormsProps {
  readonly choices: Choices | null;
  recordAction(input: unknown): Promise<unknown>;
  closeAction(input: unknown): Promise<unknown>;
  readonly assignments: readonly { readonly id: string; readonly personName: string; readonly vendorAccountName: string; readonly startedOn: string; readonly sourceKind: string; readonly endedOn: string | null }[];
}

export function ManualRegisterForms({ choices, assignments, recordAction, closeAction }: ManualRegisterFormsProps) {
  const t = useTranslations("register");
  const [companyId, setCompanyId] = useState(choices?.companies[0]?.id ?? "");
  const [accountId, setAccountId] = useState(choices?.accounts[0]?.id ?? "");
  const [status, setStatus] = useState<"manualSuccess" | "manualError" | null>(null);
  const [pending, setPending] = useState(false);
  const vendorId = choices?.accounts.find((account) => account.id === accountId)?.vendorId;

  async function submit(formData: FormData, operation: "record" | "close") {
    setPending(true);
    setStatus(null);
    try {
      await (operation === "record" ? recordAction : closeAction)(Object.fromEntries(formData));
      setStatus("manualSuccess");
    } catch {
      setStatus("manualError");
    } finally {
      setPending(false);
    }
  }

  if (!choices) return null;
  const openAssignments = assignments.filter((item) => item.sourceKind === "manual" && item.endedOn === null);

  return <section className="space-y-4 rounded border border-border bg-surface p-4" data-testid="manual_register_entry">
    <h2 className="font-semibold text-text-primary">{t("manualTitle")}</h2>
    {status ? <p role="status">{t(status)}</p> : null}
    <form onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget), "record"); }} className="grid gap-4 md:grid-cols-3">
      <label className="grid gap-1">{t("company")}<select className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary" name="companyId" onChange={(event) => setCompanyId(event.target.value)} required value={companyId}>{choices.companies.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="grid gap-1">{t("person")}<select className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary" key={companyId} name="personId" required>{choices.people.filter((item) => item.companyId === companyId).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="grid gap-1">{t("organization")}<select className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary" name="vendorAccountId" onChange={(event) => setAccountId(event.target.value)} required value={accountId}>{choices.accounts.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="grid gap-1">{t("licenseType")}<select className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary" key={vendorId} name="licenseTypeId" required>{choices.licenses.filter((item) => item.vendorId === vendorId).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="grid gap-1">{t("startedOn")}<input className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary" name="startedOn" required type="date" /></label>
      <label className="grid gap-1">{t("note")}<textarea className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary" maxLength={2000} name="note" required /></label>
      <button className="min-h-11 rounded bg-primary px-4 text-on-primary" disabled={pending} type="submit">{t(pending ? "manualPending" : "manualRecord")}</button>
    </form>
    <h3 className="font-semibold text-text-primary">{t("manualClose")}</h3>
    <form onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget), "close"); }} className="grid gap-4 md:grid-cols-3">
      <label className="grid gap-1">{t("manualAssignment")}<select className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary" name="assignmentId" required>{openAssignments.map((item) => <option key={item.id} value={item.id}>{item.personName} · {item.vendorAccountName} · {item.startedOn}</option>)}</select></label>
      <label className="grid gap-1">{t("endedOn")}<input className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary" name="endedOn" required type="date" /></label>
      <label className="grid gap-1">{t("endReason")}<select className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary" name="endReason" required><option value="left_company">{t("endReasonLeftCompany")}</option><option value="inactive">{t("endReasonInactive")}</option><option value="reallocated">{t("endReasonReallocated")}</option></select></label>
      <label className="grid gap-1">{t("note")}<textarea className="min-h-11 rounded border border-border bg-surface px-3 text-text-primary" maxLength={2000} name="note" required /></label>
      <button className="min-h-11 rounded border border-border px-4" disabled={pending || openAssignments.length === 0} type="submit">{t(pending ? "manualPending" : "manualClose")}</button>
    </form>
  </section>;
}
