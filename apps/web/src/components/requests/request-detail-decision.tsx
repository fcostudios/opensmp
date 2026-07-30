"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { DecideRequestAction } from "./approval-queue.types";
import { settleDecision } from "./decision-settlement";

export interface RequestDetailDecisionLabels {
  readonly approve: string;
  readonly approveTitle: string;
  readonly cancel: string;
  readonly decisionError: string;
  readonly reject: string;
  readonly rejectionComment: string;
  readonly rejectionDescription: string;
  readonly rejectionPlaceholder: string;
  readonly rejectionRequired: string;
  readonly rejectionTitle: string;
  readonly submitting: string;
}

export function RequestDetailDecision({
  action,
  labels,
  requestId,
}: {
  readonly action: DecideRequestAction;
  readonly labels: RequestDetailDecisionLabels;
  readonly requestId: string;
}) {
  const router = useRouter();
  return (
    <RequestDetailDecisionView
      action={action}
      labels={labels}
      refresh={() => router.refresh()}
      requestId={requestId}
    />
  );
}

export function RequestDetailDecisionView({
  action,
  labels,
  refresh,
  requestId,
}: {
  readonly action: DecideRequestAction;
  readonly labels: RequestDetailDecisionLabels;
  readonly refresh: () => void;
  readonly requestId: string;
}) {
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mode) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    dialog?.querySelector<HTMLElement>("textarea,button")?.focus();
  }, [mode]);

  function close() {
    dialogRef.current?.close();
    setMode(null);
    setError(false);
    queueMicrotask(() => openerRef.current?.focus());
  }

  function decide(decision: "approved" | "rejected") {
    if (decision === "rejected" && comment.trim().length === 0) return;
    setError(false);
    startTransition(async () => {
      const input =
        decision === "rejected"
          ? {
              requestId,
              decision,
              decisionComment: comment.trim(),
            }
          : { requestId, decision };
      const result = await settleDecision(
        action(input),
      );
      if (result.ok) {
        close();
        refresh();
      } else {
        setError(true);
      }
    });
  }

  return (
    <section
      className="rounded-lg border border-border bg-surface p-4"
      data-testid="approver_actions"
    >
      <div className="flex flex-wrap gap-3">
        <button
          className="min-h-11 rounded bg-primary px-4 font-semibold text-text-on-primary"
          data-testid="btn_aprobar"
          onClick={(event) => {
            openerRef.current = event.currentTarget;
            setMode("approve");
          }}
          type="button"
        >
          {labels.approve}
        </button>
        <button
          className="min-h-11 rounded border border-border px-4 font-semibold text-text-primary"
          data-testid="btn_rechazar"
          onClick={(event) => {
            openerRef.current = event.currentTarget;
            setMode("reject");
          }}
          type="button"
        >
          {labels.reject}
        </button>
      </div>
      {mode ? (
        <dialog
          aria-labelledby="request-decision-title"
          className="fixed inset-0 z-50 m-auto w-[min(32rem,calc(100%-2rem))] rounded border border-border bg-surface p-5 text-text-primary shadow-lg backdrop:bg-overlay"
          data-testid={mode === "reject" ? "modal_rechazo" : "modal_aprobar"}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          ref={dialogRef}
        >
          <h2
            className="font-display text-xl font-semibold"
            id="request-decision-title"
          >
            {mode === "reject" ? labels.rejectionTitle : labels.approveTitle}
          </h2>
          {mode === "reject" ? (
            <>
              <p className="mt-2 text-sm text-text-secondary">
                {labels.rejectionDescription}
              </p>
              <label className="mt-4 grid gap-1 text-sm font-medium">
                {labels.rejectionComment}
                <textarea
                  className="min-h-28 rounded border border-border p-3"
                  data-testid="decision_comment"
                  onChange={(event) => setComment(event.target.value)}
                  placeholder={labels.rejectionPlaceholder}
                  required
                  value={comment}
                />
              </label>
              <p className="mt-1 text-xs text-text-muted">
                {labels.rejectionRequired}
              </p>
            </>
          ) : null}
          {error ? (
            <p className="mt-3 rounded bg-error-bg p-3 text-error-text" role="alert">
              {labels.decisionError}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-3">
            <button
              className="min-h-11 rounded border border-border px-4"
              data-testid={
                mode === "reject"
                  ? "btn_cancelar_rechazo"
                  : "btn_cancelar_aprobacion"
              }
              onClick={close}
              type="button"
            >
              {labels.cancel}
            </button>
            <button
              className={
                mode === "reject"
                  ? "min-h-11 rounded bg-danger px-4 font-semibold text-text-on-primary disabled:opacity-50"
                  : "min-h-11 rounded bg-primary px-4 font-semibold text-text-on-primary disabled:opacity-50"
              }
              data-testid={
                mode === "reject"
                  ? "btn_confirmar_rechazo"
                  : "btn_confirmar_aprobacion"
              }
              disabled={
                pending || (mode === "reject" && comment.trim().length === 0)
              }
              onClick={() =>
                decide(mode === "reject" ? "rejected" : "approved")
              }
              type="button"
            >
              {pending
                ? labels.submitting
                : mode === "reject"
                  ? labels.reject
                  : labels.approve}
            </button>
          </div>
        </dialog>
      ) : null}
    </section>
  );
}
