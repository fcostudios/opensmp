export type ChecklistExceptionStatus = "failed" | "verification_failed";

export function checklistRequestHref(requestId: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    requestId,
  )
    ? `/solicitudes/${requestId}`
    : null;
}

export function checklistFailureReasonLabel(
  reason: string,
  labels: { readonly assignmentMissing: string },
): string {
  return reason.startsWith("checklist_assignment_missing|")
    ? labels.assignmentMissing
    : reason;
}

export function checklistExceptionStatusLabel(
  status: ChecklistExceptionStatus,
  labels: {
    readonly failed: string;
    readonly verificationFailed: string;
  },
): string {
  return status === "failed"
    ? labels.failed
    : labels.verificationFailed;
}
