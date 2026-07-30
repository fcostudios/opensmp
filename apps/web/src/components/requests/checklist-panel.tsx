"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { safeParseChecklistPayload } from "@/modules/request-workflow/orchestration-contract";
import type {
  ChecklistPanelLabels,
  ConfirmChecklistAction,
  FailChecklistAction,
} from "./checklist-panel.types";
import {
  buildChecklistConfirmation,
  buildChecklistFailure,
} from "./checklist-controller";

type ChecklistFormState =
  | { readonly status: "idle" }
  | { readonly status: "success" }
  | { readonly status: "generic_error" }
  | { readonly status: "failure_error" };

const initialChecklistFormState: ChecklistFormState = { status: "idle" };

function openDialog(dialog: HTMLDialogElement | null): void {
  if (!dialog || dialog.open) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeDialog(dialog: HTMLDialogElement | null): void {
  if (!dialog) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function trapFocus(event: KeyboardEvent<HTMLDialogElement>): void {
  if (event.key !== "Tab") return;
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      "textarea,button:not([disabled]),[href],[tabindex]:not([tabindex='-1'])",
    ),
  );
  if (controls.length < 2) return;
  const current = controls.indexOf(document.activeElement as HTMLElement);
  if (
    (!event.shiftKey && current === controls.length - 1) ||
    (event.shiftKey && current <= 0)
  ) {
    event.preventDefault();
    controls[event.shiftKey ? controls.length - 1 : 0]?.focus();
  }
}

function formatStep(
  template: string,
  params: { readonly personEmail: string; readonly licenseTypeName: string },
) {
  return template
    .replaceAll("{personEmail}", params.personEmail)
    .replaceAll("{licenseTypeName}", params.licenseTypeName);
}

export function ChecklistPanel({
  action,
  confirmAction,
  labels,
  notDoneAction,
}: {
  readonly action: {
    readonly id: string;
    readonly rawRequest: unknown;
    readonly status: "pending" | "sent";
  };
  readonly confirmAction: ConfirmChecklistAction;
  readonly labels: ChecklistPanelLabels;
  readonly notDoneAction: FailChecklistAction;
}) {
  const parsed = safeParseChecklistPayload(action.rawRequest);
  const [confirming, setConfirming] = useState(false);
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmState, confirmFormAction, confirmPending] = useActionState(
    async (): Promise<ChecklistFormState> => {
      const result = await confirmAction(
        buildChecklistConfirmation(action.id, crypto.randomUUID()),
      );
      if (result.ok) {
        setError(null);
        return { status: "success" };
      }
      setError(labels.genericError);
      return { status: "generic_error" };
    },
    initialChecklistFormState,
  );
  const [failureState, failureFormAction, failurePending] = useActionState(
    async (
      _previous: ChecklistFormState,
      formData: FormData,
    ): Promise<ChecklistFormState> => {
      const command = buildChecklistFailure(
        action.id,
        String(formData.get("reason") ?? ""),
        crypto.randomUUID(),
      );
      if (!command.ok) {
        setError(labels.failureError);
        return { status: "failure_error" };
      }
      const result = await notDoneAction(command.input);
      if (result.ok) {
        setError(null);
        return { status: "success" };
      }
      setError(labels.genericError);
      return { status: "generic_error" };
    },
    initialChecklistFormState,
  );
  const pending = confirmPending || failurePending;
  const opener = useRef<HTMLButtonElement | null>(null);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const failureDialog = useRef<HTMLDialogElement>(null);
  const failureReason = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    openDialog(confirmDialog.current);
    confirmDialog.current
      ?.querySelector<HTMLButtonElement>("[data-dialog-confirm]")
      ?.focus();
  }, [confirming]);

  useEffect(() => {
    if (!failing) return;
    openDialog(failureDialog.current);
    failureReason.current?.focus();
  }, [failing]);

  useEffect(() => {
    if (confirmState.status === "success") {
      closeDialog(confirmDialog.current);
      opener.current!.focus();
    }
  }, [confirmState]);

  useEffect(() => {
    if (failureState.status === "success") {
      closeDialog(failureDialog.current);
      opener.current!.focus();
    }
  }, [failureState]);

  if (!parsed.success || !["pending", "sent"].includes(action.status)) {
    return null;
  }

  function dismiss(
    setter: (value: boolean) => void,
    dialog: HTMLDialogElement | null,
  ) {
    closeDialog(dialog);
    setter(false);
    setError(null);
    opener.current?.focus();
  }

  return (
    <section
      className="rounded border border-border bg-surface p-5"
      data-testid="checklist_pending"
    >
      <h2 className="font-display text-xl font-semibold text-text-primary">
        {labels.title}
      </h2>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-text-secondary">
        {parsed.data.checklistSteps.map((step, index) => (
          <li key={`${step.messageKey}-${index}`}>
            {formatStep(labels.step[step.messageKey] ?? step.messageKey, step.params)}
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          className="min-h-11 rounded bg-primary px-4 font-semibold text-text-on-primary disabled:opacity-50"
          data-testid="btn_confirm_checklist"
          disabled={pending}
          onClick={(event) => {
            opener.current = event.currentTarget;
            setConfirming(true);
          }}
          type="button"
        >
          {labels.confirm}
        </button>
        <button
          className="min-h-11 rounded border border-border px-4 font-semibold text-text-primary disabled:opacity-50"
          data-testid="btn_checklist_not_done"
          disabled={pending}
          onClick={(event) => {
            opener.current = event.currentTarget;
            setFailing(true);
          }}
          type="button"
        >
          {labels.failure}
        </button>
      </div>

      {confirming ? (
        <dialog
          aria-labelledby="checklist-confirm-title"
          className="fixed inset-0 z-50 m-auto w-[min(32rem,calc(100%-2rem))] rounded border border-border bg-surface p-5 text-text-primary shadow-lg backdrop:bg-overlay"
          onCancel={(event) => {
            event.preventDefault();
            dismiss(setConfirming, confirmDialog.current);
          }}
          onKeyDown={trapFocus}
          ref={confirmDialog}
        >
          <form action={confirmFormAction}>
            <h3 className="font-display text-xl font-semibold" id="checklist-confirm-title">
              {labels.confirmTitle}
            </h3>
            <p className="mt-2 text-text-secondary">{labels.confirmBody}</p>
            {error ? <p className="mt-3 text-danger-text" role="alert">{error}</p> : null}
            <div className="mt-5 flex justify-end gap-3">
              <button
                className="min-h-11 rounded border border-border px-4"
                disabled={pending}
                onClick={() => dismiss(setConfirming, confirmDialog.current)}
                type="button"
              >
                {labels.cancel}
              </button>
              <button
                className="min-h-11 rounded bg-primary px-4 font-semibold text-text-on-primary"
                data-dialog-confirm
                disabled={pending}
                type="submit"
              >
                {pending ? labels.submitting : labels.confirm}
              </button>
            </div>
          </form>
        </dialog>
      ) : null}

      {failing ? (
        <dialog
          aria-labelledby="checklist-failure-title"
          className="fixed inset-0 z-50 m-auto w-[min(32rem,calc(100%-2rem))] rounded border border-border bg-surface p-5 text-text-primary shadow-lg backdrop:bg-overlay"
          onCancel={(event) => {
            event.preventDefault();
            dismiss(setFailing, failureDialog.current);
          }}
          onKeyDown={trapFocus}
          ref={failureDialog}
        >
          <form action={failureFormAction}>
            <h3 className="font-display text-xl font-semibold" id="checklist-failure-title">
              {labels.failureTitle}
            </h3>
            <label className="mt-4 block font-medium" htmlFor="checklist-failure-reason">
              {labels.failureLabel}
            </label>
            <textarea
              className="mt-2 min-h-28 w-full rounded border border-border bg-surface p-3"
              id="checklist-failure-reason"
              name="reason"
              onChange={(event) => setReason(event.target.value)}
              ref={failureReason}
              required
              value={reason}
            />
            {error ? <p className="mt-3 text-danger-text" role="alert">{error}</p> : null}
            <div className="mt-5 flex justify-end gap-3">
              <button
                className="min-h-11 rounded border border-border px-4"
                disabled={pending}
                onClick={() => dismiss(setFailing, failureDialog.current)}
                type="button"
              >
                {labels.cancel}
              </button>
              <button
                className="min-h-11 rounded bg-primary px-4 font-semibold text-text-on-primary disabled:opacity-50"
                disabled={pending || reason.trim().length === 0}
                type="submit"
              >
                {pending ? labels.submitting : labels.failure}
              </button>
            </div>
          </form>
        </dialog>
      ) : null}
    </section>
  );
}
