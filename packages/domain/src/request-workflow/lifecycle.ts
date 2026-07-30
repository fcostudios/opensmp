export const REQUEST_TRANSITIONS = {
  submitted: ["pending_approval"],
  pending_approval: ["approved", "rejected"],
  approved: ["provisioning", "blocked_no_seat"],
  blocked_no_seat: ["provisioning", "rejected"],
  provisioning: ["invited", "active", "failed"],
  failed: ["provisioning"],
  invited: ["active", "deprovisioned"],
  active: ["flagged_inactive", "offboarding"],
  flagged_inactive: ["active", "offboarding"],
  offboarding: ["deprovisioned", "failed"],
  deprovisioned: [],
  rejected: [],
} as const;

export type RequestState = keyof typeof REQUEST_TRANSITIONS;

export type TransitionCommand = {
  requestId: string;
  from: RequestState;
  to: RequestState;
  actorUserId: string | null;
  note: string | null;
  occurredAt: Date;
};

export function assertLegalTransition(
  from: RequestState,
  to: RequestState,
): void {
  if (
    !(REQUEST_TRANSITIONS[from] as readonly RequestState[]).includes(to)
  ) {
    throw new Error(`ILLEGAL_REQUEST_TRANSITION:${from}:${to}`);
  }
}

export function isApprovalDecisionTransition(
  from: RequestState,
  to: RequestState,
): boolean {
  return (
    from === "pending_approval" &&
    (to === "approved" || to === "rejected")
  );
}
