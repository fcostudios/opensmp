import type { ChecklistStepMessageKey } from "@/modules/request-workflow/orchestration-contract";

export type ChecklistActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

export interface ChecklistPanelLabels {
  readonly cancel: string;
  readonly confirm: string;
  readonly confirmBody: string;
  readonly confirmTitle: string;
  readonly failure: string;
  readonly failureError: string;
  readonly failureLabel: string;
  readonly failureTitle: string;
  readonly genericError: string;
  readonly step: Partial<Record<ChecklistStepMessageKey, string>>;
  readonly submitting: string;
  readonly title: string;
}

export interface ConfirmChecklistInput {
  readonly actionId: string;
  readonly confirmationId: string;
}

export interface FailChecklistInput {
  readonly actionId: string;
  readonly failureId: string;
  readonly reason: string;
}

export type ConfirmChecklistAction = (
  input: ConfirmChecklistInput,
) => Promise<ChecklistActionResult>;

export type FailChecklistAction = (
  input: FailChecklistInput,
) => Promise<ChecklistActionResult>;
