"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import Link from "next/link";

import type { DecideRequestInput } from "@smp/contracts";
import { MoneyText, QueueCard } from "@smp/ui";

import type { ApprovalQueueItem } from "@/modules/request-workflow/approval-repository";
import type {
  ApprovalQueueLabels,
  DecideRequestAction,
} from "./approval-queue.types";
import { approvalAgingTone } from "./approval-aging";
import {
  decisionSucceeded,
  retryTargetAfterDecision,
  settleDecision,
} from "./decision-settlement";
import { DecisionDialogError } from "./decision-dialog-error";
import {
  useDecisionRetryFocus,
  type DecisionRetryTarget,
} from "./decision-retry-focus";

export type {
  ApprovalQueueLabels,
  DecideRequestAction,
  DecideRequestActionResult,
} from "./approval-queue.types";

function trapDialogFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      "textarea,button:not([disabled]),[href],[tabindex]:not([tabindex='-1'])",
    ),
  );
  if (controls.length < 2) return;
  const index = controls.indexOf(document.activeElement as HTMLElement);
  if (
    (!event.shiftKey && index === controls.length - 1) ||
    (event.shiftKey && index <= 0)
  ) {
    event.preventDefault();
    controls[event.shiftKey ? controls.length - 1 : 0]?.focus();
  }
}

export function ApprovalQueue({
  action,
  items,
  labels,
  locale,
  targetRequestId = null,
}: {
  readonly action?: DecideRequestAction;
  readonly items: readonly ApprovalQueueItem[];
  readonly labels: ApprovalQueueLabels;
  readonly locale: "es-EC" | "en-US";
  readonly targetRequestId?: string | null;
}) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [approving, setApproving] = useState<ApprovalQueueItem | null>(null);
  const [rejecting, setRejecting] = useState<ApprovalQueueItem | null>(null);
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryTarget, setRetryTarget] =
    useState<DecisionRetryTarget | null>(null);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const approveDialogRef = useRef<HTMLDialogElement>(null);
  const approveConfirmRef = useRef<HTMLButtonElement>(null);
  const rejectConfirmRef = useRef<HTMLButtonElement>(null);
  const targetCardRef = useRef<HTMLDivElement>(null);
  const visibleItems = items.filter((item) => !hidden.has(item.requestId));
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
  useDecisionRetryFocus({
    approveControl: approveConfirmRef,
    error,
    pending,
    rejectControl: rejectConfirmRef,
    target: retryTarget,
  });

  useEffect(() => {
    const target = targetCardRef.current;
    if (!targetRequestId || !target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "center" });
  }, [targetRequestId]);

  useEffect(() => {
    if (!rejecting) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    commentRef.current?.focus();
  }, [rejecting]);

  useEffect(() => {
    if (!approving) return;
    const dialog = approveDialogRef.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    dialog?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [approving]);

  function finish(item: ApprovalQueueItem, decision: "approved" | "rejected") {
    setHidden((current) => new Set([...current, item.requestId]));
    setMessage(
      decision === "approved"
        ? labels.successApproved
        : labels.successRejected,
    );
    setError(null);
    setRetryTarget(null);
    setRejecting(null);
    setApproving(null);
    setComment("");
    openerRef.current?.focus();
  }

  function submitDecision(
    item: ApprovalQueueItem,
    input: DecideRequestInput,
  ) {
    setPendingRequestId(item.requestId);
    setMessage(null);
    setError(null);
    if (!action) return;
    startTransition(async () => {
      try {
        const result = await settleDecision(action(input));
        if (decisionSucceeded(result)) {
          finish(item, input.decision);
        } else {
          setError(labels.decisionError);
          setRetryTarget(retryTargetAfterDecision(result, input.decision));
        }
      } finally {
        setPendingRequestId(null);
      }
    });
  }

  function submitRejection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rejecting || comment.trim().length === 0) return;
    submitDecision(rejecting, {
      requestId: rejecting.requestId,
      decision: "rejected",
      decisionComment: comment.trim(),
    });
  }

  if (visibleItems.length === 0 && !message) {
    return (
      <section
        className="rounded border border-dashed border-border bg-surface p-10 text-center"
        data-testid="approval_empty"
      >
        <h2 className="font-display text-xl font-semibold text-text-primary">
          {labels.emptyTitle}
        </h2>
        <p className="mt-2 text-text-secondary">{labels.emptyDescription}</p>
      </section>
    );
  }

  return (
    <section className="space-y-4" data-testid="queue_cards">
      {visibleItems.map((item) => {
        const isPending = pending && pendingRequestId === item.requestId;
        const isTarget = item.requestId === targetRequestId;
        const agingTone = approvalAgingTone(item.businessHoursPending);
        return (
          <div
            aria-current={isTarget ? "true" : undefined}
            className={
              isTarget
                ? "rounded ring-2 ring-primary ring-offset-2 ring-offset-background"
                : undefined
            }
            data-testid={`approval_target_${item.requestId}`}
            id={`approval-request-${item.requestId}`}
            key={item.requestId}
            ref={isTarget ? targetCardRef : undefined}
            tabIndex={isTarget ? -1 : undefined}
          >
            <QueueCard
              actions={
              <>
                <button
                  className="min-h-11 rounded bg-primary px-4 font-semibold text-text-on-primary disabled:opacity-50"
                  data-testid={`btn_approve_${item.requestId}`}
                  disabled={isPending}
                  onClick={(event) => {
                    openerRef.current = event.currentTarget;
                    setApproving(item);
                    setError(null);
                    setRetryTarget(null);
                  }}
                  type="button"
                >
                  {isPending ? labels.submitting : labels.approve}
                </button>
                <button
                  className="min-h-11 rounded border border-border px-4 font-semibold text-text-primary disabled:opacity-50"
                  data-testid={`btn_reject_${item.requestId}`}
                  disabled={isPending}
                  onClick={(event) => {
                    openerRef.current = event.currentTarget;
                    setRejecting(item);
                    setError(null);
                    setRetryTarget(null);
                  }}
                  type="button"
                >
                  {labels.reject}
                </button>
              </>
              }
              aging={
              <span
                className={
                  agingTone === "attention"
                    ? "rounded bg-warning-bg px-3 py-1 text-sm font-semibold text-warning-text"
                    : agingTone === "warning"
                      ? "rounded bg-info-bg px-3 py-1 text-sm font-semibold text-info-text"
                      : "rounded bg-surface-muted px-3 py-1 text-sm font-semibold text-text-secondary"
                }
                data-testid="aging_chip"
                data-tone={agingTone}
              >
                {item.businessHoursPending} {labels.agingHours}
              </span>
              }
              cardId={`card_${item.requestId}`}
              company={item.companyName}
              context={
              <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div><dt className="text-text-muted">{labels.license}</dt><dd className="font-medium text-text-primary">{item.licenseTypeName}</dd></div>
                <div><dt className="text-text-muted">{labels.organization}</dt><dd className="font-medium text-text-primary">{item.vendorAccountName}</dd></div>
                <div><dt className="text-text-muted">{labels.neededBy}</dt><dd className="font-medium text-text-primary">{item.neededBy ? dateFormatter.format(new Date(`${item.neededBy}T00:00:00.000Z`)) : "—"}</dd></div>
                <div><dt className="text-text-muted">{labels.createdAt}</dt><dd className="font-medium text-text-primary" data-testid="created_at">{dateFormatter.format(item.createdAt)}</dd></div>
                <div><dt className="text-text-muted">{labels.state}</dt><dd className="font-medium text-text-primary" data-testid="request_state">{labels.pendingApproval}</dd></div>
                <div><dt className="text-text-muted">{labels.monthlyCost}</dt><dd className="font-medium text-text-primary" data-testid="monthly_rate">{item.monthlyRateUsd === null ? labels.missingRate : <MoneyText amount={item.monthlyRateUsd} locale={locale} />}</dd></div>
                <div><dt className="text-text-muted">{labels.budgetHeadroom}</dt><dd className="font-medium text-text-primary" data-testid="budget_headroom">{item.budgetHeadroomUsd === null || item.budgetMonthlyUsd === null ? labels.headroomUnavailable : <><MoneyText amount={item.budgetHeadroomUsd} locale={locale} /> {labels.availableOf} <MoneyText amount={item.budgetMonthlyUsd} locale={locale} /></>}</dd></div>
                {item.hasUnpricedCommitments ? <div><dt className="text-text-muted">{labels.committedCost}</dt><dd className="font-medium text-text-primary" data-testid="committed_rate">{labels.missingRate}</dd></div> : null}
              </dl>
              }
              justification={item.justification}
              requestLink={<Link className="underline decoration-border underline-offset-4" href={`/solicitudes/${item.requestId}`}>{item.requestNo}</Link>}
              requester={item.requesterName}
              requesterEmail={item.requesterEmail}
            />
          </div>
        );
      })}
      {approving ? (
        <dialog
          aria-labelledby="approve-title"
          className="fixed inset-0 z-50 m-auto w-[min(32rem,calc(100%-2rem))] rounded border border-border bg-surface p-5 text-text-primary shadow-lg backdrop:bg-overlay"
          data-testid="modal_approve"
          onCancel={(event) => {
            event.preventDefault();
            setApproving(null);
            openerRef.current?.focus();
          }}
          onKeyDown={trapDialogFocus}
          ref={approveDialogRef}
        >
          <h2 className="font-display text-xl font-semibold" id="approve-title">
            {labels.approveTitle}
          </h2>
          <p className="mt-2 text-sm text-text-secondary">
            {labels.approveDescription} {approving.licenseTypeName} · {approving.requesterName} · {approving.companyName}
          </p>
          <p className="mt-3 text-sm text-text-secondary">
            {approving.monthlyRateUsd === null ? labels.missingRate : <>{labels.approveCost} <MoneyText amount={approving.monthlyRateUsd} locale={locale} /></>}
          </p>
          {approving.projectedHeadroomUsd !== null ? (
            <p className="mt-2 text-sm text-text-secondary">
              {labels.approveProjected} <MoneyText amount={approving.projectedHeadroomUsd} locale={locale} />
            </p>
          ) : null}
          <DecisionDialogError message={error} testId="approve_decision_error" />
          <div className="mt-5 flex justify-end gap-3">
            <button className="min-h-11 rounded border border-border px-4" data-testid="btn_cancel_approve" onClick={() => { setApproving(null); openerRef.current?.focus(); }} type="button">{labels.cancel}</button>
            <button className="min-h-11 rounded bg-primary px-4 font-semibold text-text-on-primary disabled:opacity-50" data-testid="btn_confirm_approve" disabled={pending} onClick={() => submitDecision(approving, { requestId: approving.requestId, decision: "approved" })} ref={approveConfirmRef} type="button">{pending ? labels.submitting : labels.approve}</button>
          </div>
        </dialog>
      ) : null}
      {rejecting ? (
        <dialog
          aria-labelledby="rejection-title"
          className="fixed inset-0 z-50 m-auto w-[min(32rem,calc(100%-2rem))] rounded border border-border bg-surface p-5 text-text-primary shadow-lg backdrop:bg-overlay"
          data-testid="modal_reject"
          onCancel={(event) => {
            event.preventDefault();
            setRejecting(null);
            openerRef.current?.focus();
          }}
          onKeyDown={trapDialogFocus}
          ref={dialogRef}
        >
          <h2 className="font-display text-xl font-semibold" id="rejection-title">
            {labels.rejectionTitle}
          </h2>
          <p className="mt-2 text-sm text-text-secondary">
            {labels.rejectionDescription}
          </p>
          <DecisionDialogError message={error} testId="reject_decision_error" />
          <form className="mt-4 space-y-4" onSubmit={submitRejection}>
            <label className="grid gap-1 text-sm font-medium">
              {labels.rejectionComment}
              <textarea
                aria-describedby="rejection-required"
                className="min-h-28 rounded border border-border p-3"
                data-testid="decision_comment"
                id="decision_comment"
                onChange={(event) => setComment(event.target.value)}
                placeholder={labels.rejectionPlaceholder}
                ref={commentRef}
                required
                value={comment}
              />
            </label>
            <p className="text-xs text-text-muted" id="rejection-required">
              {labels.rejectionRequired}
            </p>
            <div className="flex justify-end gap-3">
              <button className="min-h-11 rounded border border-border px-4" data-testid="btn_cancel_reject" onClick={() => { setRejecting(null); openerRef.current?.focus(); }} type="button">{labels.cancel}</button>
              <button className="min-h-11 rounded bg-danger px-4 font-semibold text-text-on-primary disabled:opacity-50" data-testid="btn_confirm_reject" disabled={pending || comment.trim().length === 0} ref={rejectConfirmRef} type="submit">{pending ? labels.submitting : labels.reject}</button>
            </div>
          </form>
        </dialog>
      ) : null}
      <div aria-live="polite" role="status">
        {message ? <p className="rounded bg-success-bg p-3 text-success-text">{message}</p> : null}
      </div>
    </section>
  );
}
