"use server";

import { redirect } from "next/navigation";

import {
  checklistActionService,
  type ChecklistActionResult,
} from "./checklist-action-transaction";

export type { ChecklistActionResult } from "./checklist-action-transaction";

export async function confirmChecklistDone(
  input: unknown,
): Promise<ChecklistActionResult> {
  const result = await checklistActionService.confirmChecklistDone(input);
  if (result.ok) redirect(`/solicitudes/${result.requestId}?tab=assignment`);
  return result;
}

export async function markChecklistNotDone(
  input: unknown,
): Promise<ChecklistActionResult> {
  const result = await checklistActionService.markChecklistNotDone(input);
  if (result.ok) redirect(`/solicitudes/${result.requestId}?tab=actions`);
  return result;
}
