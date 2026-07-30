import {
  useEffect,
  type RefObject,
} from "react";

export type DecisionRetryTarget = "approved" | "rejected";

export function shouldRestoreRetryFocus({
  error,
  pending,
  target,
}: {
  readonly error: string | null;
  readonly pending: boolean;
  readonly target: DecisionRetryTarget | null;
}): boolean {
  return error !== null && !pending && target !== null;
}

export function restoreRetryFocus(
  control: HTMLButtonElement | null,
): boolean {
  if (control === null) return false;
  control.focus();
  return true;
}

export function useDecisionRetryFocus({
  approveControl,
  error,
  pending,
  rejectControl,
  target,
}: {
  readonly approveControl: RefObject<HTMLButtonElement | null>;
  readonly error: string | null;
  readonly pending: boolean;
  readonly rejectControl: RefObject<HTMLButtonElement | null>;
  readonly target: DecisionRetryTarget | null;
}) {
  useEffect(() => {
    if (!shouldRestoreRetryFocus({ error, pending, target })) return;
    const control =
      target === "approved"
        ? approveControl.current
        : rejectControl.current;
    restoreRetryFocus(control);
  }, [approveControl, error, pending, rejectControl, target]);
}
