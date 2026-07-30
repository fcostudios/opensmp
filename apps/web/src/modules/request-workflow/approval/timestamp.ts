export function parseApprovalTimestamp(value: unknown): Date {
  const timestamp =
    value instanceof Date
      ? new Date(value.getTime())
      : typeof value === "string" && value.trim().length > 0
        ? new Date(value)
        : new Date(Number.NaN);

  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error("APPROVAL_TIMESTAMP_INVALID");
  }
  return timestamp;
}
