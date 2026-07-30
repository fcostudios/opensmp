export type ApprovalAgingTone = "neutral" | "warning" | "attention";

export function approvalAgingTone(
  businessHoursPending: number,
): ApprovalAgingTone {
  if (businessHoursPending > 48) return "attention";
  if (businessHoursPending >= 24) return "warning";
  return "neutral";
}
