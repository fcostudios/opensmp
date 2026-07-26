// StatusPill consumes the semantic token variants defined in status-pill.css.
import "./status-pill.css";

export const STATUS_KINDS = ["success", "pending", "attention", "neutral"] as const;

export type StatusKind = (typeof STATUS_KINDS)[number];

export const REQUEST_STATUSES = [
  "submitted",
  "pending_approval",
  "approved",
  "blocked_no_seat",
  "provisioning",
  "failed",
  "invited",
  "active",
  "flagged_inactive",
  "offboarding",
  "deprovisioned",
  "rejected",
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_KIND: Record<RequestStatus, StatusKind> = {
  approved: "success",
  active: "success",
  pending_approval: "pending",
  provisioning: "pending",
  invited: "pending",
  flagged_inactive: "pending",
  blocked_no_seat: "attention",
  failed: "attention",
  rejected: "attention",
  submitted: "neutral",
  offboarding: "neutral",
  deprovisioned: "neutral",
};

export interface StatusPillProps {
  status: RequestStatus;
  /** Text label — status is NEVER color-only (a11y baseline). */
  label: string;
}

export function StatusPill({ status, label }: StatusPillProps) {
  const kind = REQUEST_STATUS_KIND[status];
  return (
    <span
      className={`status-pill status-pill--${kind}`}
      data-status={status}
    >
      {label}
    </span>
  );
}
