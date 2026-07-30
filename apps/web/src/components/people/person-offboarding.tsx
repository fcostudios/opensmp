"use client";

import {
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";

import type { StartOffboardingInput } from "@smp/contracts";

import type {
  StartOffboardingAction,
  StartOffboardingActionState,
} from "@/modules/org-registry/actions/people";

export interface PersonOffboardingLabels {
  readonly cancel: string;
  readonly confirmOffboarding: string;
  readonly inactive: string;
  readonly leftCompany: string;
  readonly offboardingDescription: string;
  readonly offboardingError: string;
  readonly offboardingNote: string;
  readonly offboardingNotePlaceholder: string;
  readonly offboardingReason: string;
  readonly offboardingSubmitting: string;
  readonly offboardingSuccess: string;
  readonly offboardingTitle: string;
  readonly offboardingUnavailable: string;
  readonly reallocated: string;
  readonly startOffboarding: string;
}

export function PersonOffboarding({
  action,
  labels,
  personId,
}: {
  readonly action: StartOffboardingAction;
  readonly labels: PersonOffboardingLabels;
  readonly personId: string;
}) {
  const openerRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [endReason, setEndReason] =
    useState<StartOffboardingInput["endReason"]>("left_company");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<
    StartOffboardingActionState | undefined
  >();
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setNote("");
    setResult(undefined);
    openerRef.current?.focus();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const next = await action({ personId, endReason, note });
      setResult(next);
      if (next.ok) {
        setOpen(false);
        setNote("");
        openerRef.current?.focus();
      }
    });
  }

  return (
    <div>
      <details
        className="rounded border border-border bg-surface p-3"
        data-testid="modal_offboarding"
        onToggle={(event) => setOpen(event.currentTarget.open)}
        open={open}
      >
        <summary
          className="cursor-pointer font-semibold"
          data-testid="btn_start_offboarding"
          ref={openerRef}
        >
          {labels.startOffboarding}
        </summary>
        <div className="mt-4 space-y-3">
          <h2 className="font-display text-xl font-semibold">
            {labels.offboardingTitle}
          </h2>
          <p className="text-sm text-text-secondary">
            {labels.offboardingDescription}
          </p>
          <form className="space-y-3" onSubmit={submit}>
            <label className="block space-y-1 text-sm font-medium">
              <span>{labels.offboardingReason}</span>
              <select
                className="min-h-11 w-full rounded border border-border px-3"
                data-testid="end_reason"
                onChange={(event) =>
                  setEndReason(
                    event.target
                      .value as StartOffboardingInput["endReason"],
                  )
                }
                required
                value={endReason}
              >
                <option value="left_company">
                  {labels.leftCompany}
                </option>
                <option value="inactive">{labels.inactive}</option>
                <option value="reallocated">
                  {labels.reallocated}
                </option>
              </select>
            </label>
            <label className="block space-y-1 text-sm font-medium">
              <span>{labels.offboardingNote}</span>
              <textarea
                className="min-h-24 w-full rounded border border-border p-3"
                data-testid="offboarding_note"
                maxLength={1_000}
                onChange={(event) => setNote(event.target.value)}
                placeholder={labels.offboardingNotePlaceholder}
                required
                value={note}
              />
            </label>
            <div className="flex justify-end gap-3">
              <button
                className="min-h-11 rounded border border-border px-4"
                data-testid="btn_cancel_offboarding"
                onClick={close}
                type="button"
              >
                {labels.cancel}
              </button>
              <button
                className="min-h-11 rounded bg-primary px-4 text-text-on-primary disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="btn_confirm_offboarding"
                disabled={pending || note.trim().length === 0}
                type="submit"
              >
                {pending
                  ? labels.offboardingSubmitting
                  : labels.confirmOffboarding}
              </button>
            </div>
          </form>
        </div>
      </details>
      <div aria-live="polite" role="status">
        {result?.ok ? (
          <p className="mt-2 text-success">
            {labels.offboardingSuccess}
          </p>
        ) : result?.globalError ? (
          <p className="mt-2 text-error-text">
            {result.globalError ===
            "person_offboarding_unavailable"
              ? labels.offboardingUnavailable
              : labels.offboardingError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
