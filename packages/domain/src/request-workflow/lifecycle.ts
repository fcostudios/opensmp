export const REQUEST_TRANSITIONS = {
  submitted: ["pending_approval"],
  pending_approval: ["approved", "rejected"],
  approved: ["provisioning", "blocked_no_seat"],
  blocked_no_seat: ["provisioning", "rejected"],
  provisioning: ["invited", "active", "failed", "blocked_no_seat"],
  failed: ["provisioning"],
  invited: ["active", "deprovisioned"],
  active: ["flagged_inactive", "offboarding"],
  flagged_inactive: ["active", "offboarding"],
  offboarding: ["deprovisioned", "failed"],
  deprovisioned: [],
  rejected: [],
} as const;

export type RequestState = keyof typeof REQUEST_TRANSITIONS;

export function isRequestTransitionAllowed(
  from: RequestState,
  to: RequestState,
): boolean {
  const targets = REQUEST_TRANSITIONS[from] as readonly RequestState[];
  return targets.indexOf(to) >= 0;
}

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
    !isRequestTransitionAllowed(from, to)
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

export interface OffboardingConfirmation {
  readonly actionId: string;
  readonly requestId: string;
  readonly companyId: string;
  readonly actorUserId: string | null;
  readonly confirmationId: string;
  readonly confirmedAt: Date;
}
export interface OffboardingCompletion {
  readonly requestId: string;
  readonly assignmentIds: readonly string[];
  readonly endedOn: string;
  readonly endReason: "left_company" | "inactive";
  readonly confirmedAt: string;
  readonly confirmationId: string;
  readonly replayed: boolean;
}
export interface OffboardingFacts {
  readonly action: { readonly id: string; readonly requestId: string; readonly vendorAccountId: string; readonly kind: string; readonly mode: string; readonly status: string; readonly operation: unknown; readonly context: unknown };
  readonly request: { readonly id: string; readonly companyId: string; readonly personId: string; readonly vendorAccountId: string; readonly licenseTypeId: string; readonly assignmentId: string | null; readonly state: string };
  readonly assignments: readonly { readonly id: string; readonly requestId: string | null; readonly companyId: string; readonly personId: string; readonly vendorAccountId: string; readonly licenseTypeId: string; readonly startedOn: string; readonly endedOn: string | null; readonly endReason: string | null }[];
  readonly original: OffboardingCompletion | null;
}
export interface OffboardingPersistencePort {
  loadFacts(actionId: string): Promise<OffboardingFacts>;
  complete(result: OffboardingCompletion, command: OffboardingConfirmation): Promise<void>;
}
export interface OffboardingTransactionPort {
  runAtomic<T>(work: (transaction: OffboardingPersistencePort) => Promise<T>): Promise<T>;
}

export function validateOffboardingFacts(command:OffboardingConfirmation,facts:OffboardingFacts): "left_company" | "inactive" {
  const { action, request, assignments } = facts;
    const context = action.context as { assignmentIds?: unknown; endReason?: unknown; requestId?: unknown; vendorAccountId?: unknown; personId?: unknown } | null;
    if (!context || typeof context !== "object" || !Array.isArray(context.assignmentIds)) throw new Error("OFFBOARDING_CONFLICT");
    const ids = context.assignmentIds;
    if (ids.length === 0 || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) throw new Error("OFFBOARDING_CONFLICT");
    if (context.endReason !== "left_company" && context.endReason !== "inactive") throw new Error("OFFBOARDING_CONFLICT");
    if (action.id !== command.actionId || action.requestId !== request.id || request.id !== command.requestId || request.companyId !== command.companyId || action.vendorAccountId !== request.vendorAccountId || action.operation !== "deprovision" || !["remove", "checklist"].includes(action.kind) || !["automated", "orchestration"].includes(action.mode) || (action.kind === "checklist" && action.mode !== "orchestration")) throw new Error("OFFBOARDING_CONFLICT");
    if (context.requestId !== request.id || context.personId !== request.personId || context.vendorAccountId !== request.vendorAccountId || !request.assignmentId || !ids.includes(request.assignmentId)) throw new Error("OFFBOARDING_CONFLICT");
    if (assignments.length !== ids.length || assignments.some(row => !ids.includes(row.id) || row.requestId !== request.id || row.companyId !== request.companyId || row.personId !== request.personId || row.vendorAccountId !== request.vendorAccountId || row.licenseTypeId !== request.licenseTypeId)) throw new Error("OFFBOARDING_CONFLICT");
  return context.endReason;
}

/** Completion decisions are portable; the caller supplies one atomic persistence port. */
export async function finalizeOffboarding(command: OffboardingConfirmation, port: OffboardingTransactionPort): Promise<OffboardingCompletion> {
  const conflict = () => { throw new Error("OFFBOARDING_CONFLICT"); };
  if (!command.confirmationId.trim() || command.confirmationId.length > 200 || !Number.isFinite(command.confirmedAt.getTime())) conflict();
  return port.runAtomic(async transaction => {
    const facts = await transaction.loadFacts(command.actionId);
    const reason = validateOffboardingFacts(command,facts);
    const { action, request, assignments, original } = facts;
    const ids = assignments.map(row=>row.id);
    if (original) {
      if (request.state !== "deprovisioned" || action.status !== "confirmed" || original.requestId !== request.id || original.endReason !== reason || original.assignmentIds.length !== ids.length || original.assignmentIds.some(id => !ids.includes(id)) || assignments.some(row => row.endedOn !== original.endedOn || row.endReason !== original.endReason)) return conflict();
      return { ...original, replayed: true };
    }
    if (request.state !== "offboarding" || !["pending", "sent", "failed"].includes(action.status) || assignments.some(row => row.endedOn !== null || row.endReason !== null)) return conflict();
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(command.confirmedAt);
    const part = (type: string) => parts.find(value => value.type === type)!.value;
    const endedOn = `${part("year")}-${part("month")}-${part("day")}`;
    if (assignments.some(row => row.startedOn > endedOn)) return conflict();
    const result: OffboardingCompletion = { requestId: request.id, assignmentIds: assignments.map(row => row.id), endedOn, endReason: reason, confirmedAt: command.confirmedAt.toISOString(), confirmationId: command.confirmationId, replayed: false };
    await transaction.complete(result, command);
    return result;
  });
}
