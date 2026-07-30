import type {
  ChecklistActionResult,
  ConfirmChecklistInput,
  FailChecklistInput,
} from "./checklist-panel.types";

export function buildChecklistConfirmation(
  actionId: string,
  confirmationId: string,
): ConfirmChecklistInput {
  return {
    actionId,
    confirmationId,
  };
}

export function buildChecklistFailure(
  actionId: string,
  reason: string,
  failureId: string,
): { readonly ok: false } | {
  readonly ok: true;
  readonly input: FailChecklistInput;
} {
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false };
  return {
    ok: true,
    input: { actionId, failureId, reason: trimmed },
  };
}

export function checklistSettlement(result: ChecklistActionResult): {
  readonly close: boolean;
  readonly error: boolean;
} {
  return result.ok
    ? { close: true, error: false }
    : { close: false, error: true };
}
