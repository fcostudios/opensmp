"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export interface AcknowledgeAlertLabels {
  readonly action: string;
  readonly confirmTitle: string;
  readonly confirmBody: string;
  readonly confirm: string;
  readonly cancel: string;
  readonly success: string;
  readonly error: string;
}

export function AcknowledgeAlertButton({
  acknowledge,
  alertEventId,
  labels,
}: {
  acknowledge(input: { alertEventId: string }): Promise<{ readonly ok: boolean }>;
  readonly alertEventId: string;
  readonly labels: AcknowledgeAlertLabels;
}) {
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<"success" | "error" | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (outcome !== null) {
    return (
      <p role="status" className="text-sm text-text-secondary">
        {outcome === "success" ? labels.success : labels.error}
      </p>
    );
  }

  if (!confirming) {
    return (
      <button
        className="rounded bg-primary px-3 py-2 text-sm font-semibold text-text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        data-testid="act_reconocer"
        onClick={() => setConfirming(true)}
        type="button"
      >
        {labels.action}
      </button>
    );
  }

  return (
    <div className="space-y-2" role="group" aria-label={labels.confirmTitle}>
      <p className="text-sm text-text-secondary">{labels.confirmBody}</p>
      <button
        className="rounded bg-primary px-3 py-2 text-sm font-semibold text-text-on-primary"
        data-testid="act_reconocer_confirm"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            try {
              const result = await acknowledge({ alertEventId });
              setOutcome(result.ok ? "success" : "error");
              if (result.ok) router.refresh();
            } catch {
              setOutcome("error");
            }
          });
        }}
        type="button"
      >
        {labels.confirm}
      </button>
      <button
        className="rounded border border-border px-3 py-2 text-sm font-semibold text-text-primary"
        data-testid="act_reconocer_cancel"
        disabled={pending}
        onClick={() => setConfirming(false)}
        type="button"
      >
        {labels.cancel}
      </button>
    </div>
  );
}
