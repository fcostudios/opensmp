/** BR-18: repeated finalization never rewrites final or reconciled evidence. */
export function assertFinalizationAccess(role: string | null | undefined): void {
  if (role !== "central_finance" && role !== "group_admin") throw new Error("CLOSE_ACCESS_FORBIDDEN");
}
export function finalizeStatementStatus(status: "draft" | "final" | "reconciled") {
  return status === "draft" ? "final" : status;
}
