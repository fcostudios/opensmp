"use client";

import { useEffect, useRef, useState } from "react";

export function PayloadDialog({
  actionId,
  closeLabel,
  label,
  noResponseLabel,
  rawRequest,
  rawRequestLabel,
  rawResponse,
  rawResponseLabel,
}: {
  readonly actionId: string;
  readonly closeLabel: string;
  readonly label: string;
  readonly noResponseLabel: string;
  readonly rawRequest: unknown;
  readonly rawRequestLabel: string;
  readonly rawResponse: unknown;
  readonly rawResponseLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    dialog?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);

  function close() {
    dialogRef.current?.close();
    setOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  }

  return (
    <>
      <button
        className="mt-2 block min-h-11 text-xs font-semibold text-primary underline underline-offset-4"
        data-testid={`open_payload_${actionId}`}
        onClick={() => setOpen(true)}
        ref={triggerRef}
        type="button"
      >
        {label}
      </button>
      {open ? (
        <dialog
          aria-labelledby={`payload_title_${actionId}`}
          className="fixed inset-0 z-50 m-auto w-[min(42rem,calc(100%-2rem))] rounded border border-border bg-surface p-5 text-text-primary shadow-lg backdrop:bg-overlay"
          data-testid="modal_payload"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          ref={dialogRef}
        >
          <h2
            className="font-display text-xl font-semibold"
            id={`payload_title_${actionId}`}
          >
            {label}
          </h2>
          <div className="mt-4 grid gap-4">
            <section data-testid="raw_request">
              <h3 className="text-sm font-semibold text-text-primary">
                {rawRequestLabel}
              </h3>
              <pre className="mt-1 max-h-[26vh] overflow-auto rounded bg-surface-muted p-3 font-mono text-xs text-text-secondary">
                {JSON.stringify(rawRequest, null, 2)}
              </pre>
            </section>
            <section data-testid="raw_response">
              <h3 className="text-sm font-semibold text-text-primary">
                {rawResponseLabel}
              </h3>
              {rawResponse === null ? (
                <p className="mt-1 rounded bg-surface-muted p-3 text-sm text-text-secondary">
                  {noResponseLabel}
                </p>
              ) : (
                <pre className="mt-1 max-h-[26vh] overflow-auto rounded bg-surface-muted p-3 font-mono text-xs text-text-secondary">
                  {JSON.stringify(rawResponse, null, 2)}
                </pre>
              )}
            </section>
          </div>
          <div className="mt-5 flex justify-end">
            <button
              className="min-h-11 rounded border border-border px-4 font-semibold"
              data-testid="btn_cerrar_payload"
              onClick={close}
              type="button"
            >
              {closeLabel}
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
