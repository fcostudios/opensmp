"use client";
import React, { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useStore } from "zustand";
import type { UsageViewProps } from "./usage-view";
import { createReclamationSelectionStore } from "./reclamation-selection-store";
import { ROUTE_SCR_PERSON_DETAIL } from "../../lib/routes";

export type UsageBatchTableProps = UsageViewProps;
function trapFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("textarea:not([disabled]),button:not([disabled])"));
  const current = controls.indexOf(document.activeElement as HTMLElement);
  if ((!event.shiftKey && current === controls.length - 1) || (event.shiftKey && current <= 0)) {
    event.preventDefault();
    controls[event.shiftKey ? controls.length - 1 : 0]?.focus();
  }
}
export function UsageBatchTable({ model, locale, labels, propose, requestId = () => crypto.randomUUID() }: UsageBatchTableProps) {
  const [store] = useState(createReclamationSelectionStore);
  const state = useStore(store);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const id = useId();
  const scope = `${model.filters.companyId ?? ""}:${model.filters.window}:${model.filters.cursor ?? ""}`;
  useEffect(() => { store.getState().reset(); }, [store, scope]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (state.open) {
      if (!dialog.open) {
        if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.open = true;
        dialog.querySelector<HTMLElement>("textarea")?.focus();
      }
      wasOpen.current = true;
    } else {
      if (typeof dialog.close === "function") dialog.close(); else dialog.removeAttribute("open");
      if (wasOpen.current) {
        if (triggerRef.current?.disabled) triggerRef.current.parentElement?.previousElementSibling?.querySelector<HTMLElement>("input:not([disabled])")?.focus();
        else triggerRef.current?.focus();
        wasOpen.current = false;
      }
    }
  }, [state.open, state.generation]);
  useEffect(() => { if (state.result?.status === "success") dialogRef.current?.querySelector<HTMLElement>("button")?.focus(); }, [state.result]);
  const numbers = new Intl.NumberFormat(locale);
  const dates = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const date = (value: string) => <time dateTime={value}>{dates.format(new Date(`${value}T00:00:00Z`))}</time>;
  const badgeClass = "inline-flex rounded border border-border bg-surface-alt px-2 py-1 text-xs text-text-secondary";
  const eligible = new Set(model.rows.filter(row => row.classification === "inactive" || row.anchorState === "flagged_inactive").map(row => row.personId));
  const selectedRows = model.rows.filter(row => state.selectedPersonIds.includes(row.personId));
  const selectedPeople = [...new Map(selectedRows.map(row => [row.personId, row])).values()];
  async function submit() {
    if (!propose) return;
    const submission = store.getState().beginSubmission(model.filters.companyId, requestId);
    if (!submission) return;
    try {
      const result = await propose({ ...submission.command, note: submission.command.note ?? undefined });
      store.getState().finishSubmission(submission, result);
    } catch { store.getState().finishSubmission(submission, { status: "error", code: "unexpected" }); }
  }
  const buttonClass = "min-h-11 rounded bg-primary px-4 font-semibold text-on-primary disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-primary";
  return <>
      <section className="overflow-x-auto rounded border border-border" data-testid="usage_table">
        <table className="w-full border-collapse text-sm">
          <caption className="p-4 text-left font-semibold text-text-primary">{labels.tableCaption}</caption>
          <thead className="bg-surface-alt text-left text-text-secondary"><tr>
            {[...(propose ? [labels.proposal.select] : []), labels.person, labels.company, labels.lastKnownActivity, labels.daysInactive, labels.qualification, labels.license, labels.state, labels.dataThrough].map(header => <th className="p-3" key={header} scope="col">{header}</th>)}
          </tr></thead>
          <tbody className="text-text-primary">
            {model.rows.map(row => <tr className="border-t border-border" key={row.assignmentId} data-assignment-id={row.assignmentId}>
              {propose ? <td className="p-3"><input type="checkbox" aria-label={labels.proposal.selectPerson.replace("{person}", row.personName)} data-testid={`select_person_${row.personId}`} checked={state.selectedPersonIds.includes(row.personId)} disabled={!eligible.has(row.personId) || state.submitting || state.open} onChange={() => state.togglePerson(row.personId)} /></td> : null}
              <td className="p-3"><Link className="font-semibold text-primary underline" href={ROUTE_SCR_PERSON_DETAIL.replace(":personId", row.personId)}>{row.personName}</Link></td>
              <td className="p-3">{row.companyName}</td>
              <td className="p-3">{row.lastActivityDate === null ? labels.unknown : date(row.lastActivityDate)}</td>
              <td className="p-3 text-right font-mono">{row.daysInactive === null ? labels.unknown : numbers.format(row.daysInactive)}</td>
              <td className="p-3"><span className={badgeClass}>{row.classification === "no_data" ? labels.noData : row.classification === "inactive" ? labels.inactive : labels.active}</span><span className="ml-2 text-text-muted">{numbers.format(model.filters.window)}</span></td>
              <td className="p-3">{`${row.licenseTypeName} · ${row.vendorAccountName}`}</td>
              <td className="p-3"><span className={badgeClass}>{row.anchorState === null ? labels.anchorUnavailable : labels.states[row.anchorState]}</span></td>
              <td className="p-3">{date(row.dataThrough)}</td>
            </tr>)}
            {model.rows.length === 0 ? <tr><td className="p-6 text-center text-text-secondary" colSpan={propose ? 9 : 8}>{labels.empty}</td></tr> : null}
          </tbody>
        </table>
      </section>
      {propose ? <div className="space-y-4">
        <button ref={triggerRef} type="button" className={buttonClass} data-testid="btn_propose_reclamation" disabled={state.selectedPersonIds.length === 0 || state.open || state.submitting} onClick={state.openDialog}>{labels.proposal.trigger}</button>
        <dialog ref={dialogRef} data-testid="modal_propose_reclamation" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} className="max-h-[90vh] w-[min(40rem,calc(100%-2rem))] overflow-auto rounded border border-border bg-surface p-6 text-text-primary backdrop:bg-overlay"
          onCancel={event => { event.preventDefault(); state.closeDialog(); }}
          onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); state.closeDialog(); } else trapFocus(event); }}>
          <h2 className="font-display text-2xl font-semibold" id={`${id}-title`}>{labels.proposal.title}</h2>
          <p className="mt-2 text-sm text-text-secondary" id={`${id}-description`}>{labels.proposal.description}</p>
          <div data-testid="selected_summary" className="mt-4 space-y-2 text-sm">
            <p>{labels.proposal.selectedPeople.replace("{count}", numbers.format(selectedPeople.length))}</p>
            <p>{labels.proposal.displayedLicenses.replace("{count}", numbers.format(selectedRows.length))}</p>
            <ul>{selectedPeople.map(row => <li key={row.personId}>{`${row.personName} · ${row.companyName}`}</li>)}</ul>
            <p className="text-text-secondary">{labels.proposal.allOpenWarning}</p>
          </div>
          <form className="mt-4 space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
            <label className="grid gap-2 text-sm" htmlFor={`${id}-note`}>{labels.proposal.note}
              <textarea id={`${id}-note`} data-testid="note" placeholder={labels.proposal.placeholder} className="min-h-24 rounded border border-border bg-surface px-3 py-2 text-text-primary" maxLength={2000} value={state.note} disabled={state.submitting || state.result?.status === "success"} onChange={event => state.setNote(event.target.value)} />
            </label>
            {state.result?.status === "error" ? <p role="alert" className="rounded bg-error-bg p-3 text-error-text">{labels.proposal.errors[state.result.code]}</p> : null}
            {state.result?.status === "success" ? <p role="status" className="text-success-text">{labels.proposal.success.replace("{created}", numbers.format(state.result.created)).replace("{existing}", numbers.format(state.result.existing))}</p> : null}
            <div className="flex flex-wrap gap-3">
              <button type="button" className="min-h-11 rounded border border-border px-4 disabled:opacity-50" disabled={state.submitting} onClick={state.closeDialog}>{state.result?.status === "success" ? labels.proposal.close : labels.proposal.cancel}</button>
              <button type="submit" data-testid="btn_send_proposals" className={buttonClass} disabled={state.submitting || state.result?.status === "success" || state.selectedPersonIds.length === 0}>{state.submitting ? labels.proposal.submitting : labels.proposal.send}</button>
            </div>
          </form>
        </dialog>
      </div> : null}
  </>;
}
