"use client";

import { useFormStatus } from "react-dom";

export function ProvisioningRetrySubmit({
  label,
  pendingLabel,
  testId,
}: {
  readonly label: string;
  readonly pendingLabel: string;
  readonly testId: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      aria-busy={pending}
      className="rounded border border-border px-3 py-2 text-sm font-semibold text-text-primary disabled:text-text-muted"
      data-testid={testId}
      disabled={pending}
      type="submit"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
