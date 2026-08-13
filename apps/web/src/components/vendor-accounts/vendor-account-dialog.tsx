"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import {
  VendorAccountForm,
  type VendorAccountFormAction,
  type VendorAccountFormLabels,
} from "./vendor-account-form";

function openNativeDialog(dialog: HTMLDialogElement | null): void {
  if (!dialog || dialog.open) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeNativeDialog(dialog: HTMLDialogElement | null): void {
  if (!dialog) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function trapFocus(event: KeyboardEvent<HTMLDialogElement>): void {
  if (event.key !== "Tab") return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    "input:not([type='hidden']),select,textarea,button:not([disabled]),a[href],[tabindex]:not([tabindex='-1'])",
  ));
  if (controls.length < 2) return;
  const current = controls.indexOf(document.activeElement as HTMLElement);
  if ((!event.shiftKey && current === controls.length - 1) || (event.shiftKey && current <= 0)) {
    event.preventDefault();
    controls[event.shiftKey ? controls.length - 1 : 0]?.focus();
  }
}

export function VendorAccountDialog({
  action,
  labels,
  vendors,
}: {
  readonly action: VendorAccountFormAction;
  readonly labels: VendorAccountFormLabels;
  readonly vendors: readonly { readonly id: string; readonly name: string }[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openRef = useRef(false);
  const pendingRef = useRef(false);
  const restoreFocusRef = useRef(false);
  const sessionRef = useRef(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [session, setSession] = useState(0);

  useEffect(() => {
    if (open) {
      openNativeDialog(dialogRef.current);
      dialogRef.current
        ?.querySelector<HTMLElement>("select,input,textarea,button")
        ?.focus();
      return;
    }
    if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open, session]);

  function dismiss(force = false) {
    if (pendingRef.current && !force) return;
    closeNativeDialog(dialogRef.current);
    openRef.current = false;
    restoreFocusRef.current = true;
    setOpen(false);
  }

  function complete(completedSession: number) {
    if (completedSession !== sessionRef.current || !openRef.current) return;
    pendingRef.current = false;
    setPending(false);
    setFeedback(labels.success);
    dismiss(true);
  }

  function updatePending(updatedSession: number, nextPending: boolean) {
    if (updatedSession !== sessionRef.current) return;
    pendingRef.current = nextPending;
    setPending(nextPending);
  }

  return (
    <>
      <button
        className="inline-flex min-h-11 items-center justify-center rounded bg-primary px-4 font-semibold text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        data-testid="btn_new_vendor_account"
        disabled={open || pending}
        onClick={() => {
          if (openRef.current || pendingRef.current) return;
          const nextSession = sessionRef.current + 1;
          sessionRef.current = nextSession;
          openRef.current = true;
          setFeedback(null);
          setSession(nextSession);
          setOpen(true);
        }}
        ref={triggerRef}
        type="button"
      >
        {labels.trigger}
      </button>
      {feedback ? <p className="text-sm font-medium text-success-text" role="status">{feedback}</p> : null}
      <dialog
        aria-describedby="vendor-account-dialog-description"
        aria-labelledby="vendor-account-dialog-title"
        className="max-h-[90vh] w-[min(40rem,calc(100%-2rem))] overflow-auto rounded border border-border bg-surface p-6 text-text-primary backdrop:bg-overlay"
        data-testid="modal_new_vendor_account"
        onCancel={(event) => {
          event.preventDefault();
          dismiss();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (!pendingRef.current) dismiss();
            return;
          }
          trapFocus(event);
        }}
        ref={dialogRef}
      >
        <h2 className="font-display text-2xl font-semibold" id="vendor-account-dialog-title">{labels.title}</h2>
        <p className="mt-2 text-sm text-text-secondary" id="vendor-account-dialog-description">{labels.description}</p>
        <div className="mt-5">
          <VendorAccountForm
            action={action}
            key={session}
            labels={labels}
            onCancel={dismiss}
            onPendingChange={(nextPending) => updatePending(session, nextPending)}
            onSuccess={() => complete(session)}
            vendors={vendors}
          />
        </div>
      </dialog>
    </>
  );
}
