"use client";

import { useEffect, useRef } from "react";

import { AuditTrailViewer } from "@smp/ui";

import {
  AUDIT_TIME_ZONE,
  type AuditListItem,
} from "@/modules/audit/types";

interface AuditDiffLabels {
  readonly actor: string;
  readonly added: string;
  readonly after: string;
  readonly before: string;
  readonly close: string;
  readonly details: string;
  readonly note: string;
  readonly occurredAt: string;
  readonly removed: string;
  readonly systemActor: string;
}

export interface AuditDiffDialogProps {
  readonly item: AuditListItem;
  readonly labels: AuditDiffLabels;
  readonly locale: string;
  readonly onClose: () => void;
  readonly open: boolean;
}

export function nextFocusIndex(
  current: number,
  count: number,
  reverse: boolean,
): number {
  if (count <= 0) return -1;
  return reverse
    ? (current - 1 + count) % count
    : (current + 1) % count;
}

export function AuditDiffDialog({
  item,
  labels,
  locale,
  onClose,
  open,
}: AuditDiffDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      aria-labelledby="audit-dialog-title"
      className="max-h-[90vh] w-[min(56rem,calc(100%-2rem))] overflow-auto rounded border border-border bg-surface p-6 text-text-primary backdrop:bg-overlay"
      data-testid="modal_audit_diff"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const focusable = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
          ),
        );
        if (focusable.length === 0) return;
        const current = focusable.indexOf(
          document.activeElement as HTMLElement,
        );
        const next = nextFocusIndex(
          current < 0 ? 0 : current,
          focusable.length,
          event.shiftKey,
        );
        if (
          (event.shiftKey && current <= 0) ||
          (!event.shiftKey && current === focusable.length - 1)
        ) {
          event.preventDefault();
          focusable[next]?.focus();
        }
      }}
      ref={dialogRef}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold" id="audit-dialog-title">
            {labels.details}
          </h2>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-text-secondary">
                {labels.occurredAt}
              </dt>
              <dd>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: AUDIT_TIME_ZONE,
                }).format(new Date(item.occurredAt))}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-text-secondary">
                {labels.actor}
              </dt>
              <dd>{item.actorEmail ?? labels.systemActor}</dd>
            </div>
          </dl>
        </div>
        <button
          className="min-h-11 rounded border border-border px-4"
          data-testid="btn_close_audit_diff"
          onClick={onClose}
          type="button"
        >
          {labels.close}
        </button>
      </div>
      <div className="mt-6">
        <AuditTrailViewer
          after={item.after}
          before={item.before}
          labels={{
            added: labels.added,
            after: labels.after,
            before: labels.before,
            note: labels.note,
            removed: labels.removed,
          }}
          note={item.note}
        />
      </div>
    </dialog>
  );
}
