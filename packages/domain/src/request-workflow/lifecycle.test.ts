import { describe, expect, it } from "vitest";

import {
  REQUEST_TRANSITIONS,
  finalizeOffboarding,
  type OffboardingFacts,
  type OffboardingConfirmation,
  type OffboardingCompletion,
  type OffboardingPersistencePort,
  type OffboardingTransactionPort,
  assertLegalTransition,
  isApprovalDecisionTransition,
  isRequestTransitionAllowed,
  type RequestState,
} from "./lifecycle.js";

const EXPECTED_TRANSITIONS = {
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

const REQUEST_STATES = Object.keys(
  EXPECTED_TRANSITIONS,
) as RequestState[];

const ALLOWED_EDGES = Object.entries(EXPECTED_TRANSITIONS).flatMap(
  ([from, targets]) =>
    targets.map((to) => [from, to] as [RequestState, RequestState]),
);

const ILLEGAL_EDGES = REQUEST_STATES.flatMap((from) =>
  REQUEST_STATES.filter(
    (to) =>
      !(EXPECTED_TRANSITIONS[from] as readonly RequestState[]).includes(to),
  ).map((to) => [from, to] as [RequestState, RequestState]),
);

describe("US-014 request lifecycle", () => {
  it("pins all 12 states and every legal edge to the canonical graph", () => {
    expect(REQUEST_TRANSITIONS).toEqual(EXPECTED_TRANSITIONS);
    expect(REQUEST_STATES).toHaveLength(12);
    expect(ALLOWED_EDGES).toHaveLength(20);
  });

  it.each(ALLOWED_EDGES)(
    "accepts the legal %s -> %s transition",
    (from, to) => {
      expect(REQUEST_TRANSITIONS[from]).toContain(to);
      expect(assertLegalTransition(from, to)).toBeUndefined();
    },
  );

  it.each(ILLEGAL_EDGES)(
    "rejects the illegal %s -> %s transition with the stable contract",
    (from, to) => {
      expect(() => assertLegalTransition(from, to)).toThrow(
        new Error(`ILLEGAL_REQUEST_TRANSITION:${from}:${to}`),
      );
    },
  );

  it("allows only provisioning -> blocked_no_seat and keeps the reverse edge explicit", () => {
    expect(() => assertLegalTransition("provisioning", "blocked_no_seat")).not.toThrow();
    expect(() => assertLegalTransition("blocked_no_seat", "provisioning")).not.toThrow();
    expect(() => assertLegalTransition("blocked_no_seat", "invited")).toThrow(
      new Error("ILLEGAL_REQUEST_TRANSITION:blocked_no_seat:invited"),
    );
    expect(() => assertLegalTransition("failed", "blocked_no_seat")).toThrow(
      new Error("ILLEGAL_REQUEST_TRANSITION:failed:blocked_no_seat"),
    );
  });

  it.each(ALLOWED_EDGES)("classifies %s -> %s as allowed", (from, to) => {
    expect(isRequestTransitionAllowed(from, to)).toBe(true);
  });

  it.each(ILLEGAL_EDGES)("classifies %s -> %s as illegal", (from, to) => {
    expect(isRequestTransitionAllowed(from, to)).toBe(false);
  });

  it.each(ALLOWED_EDGES)(
    "classifies decision-field persistence for %s -> %s",
    (from, to) => {
      expect(isApprovalDecisionTransition(from, to)).toBe(
        from === "pending_approval" &&
          (to === "approved" || to === "rejected"),
      );
    },
  );

  it.each(ILLEGAL_EDGES)(
    "does not classify illegal %s -> %s as a decision",
    (from, to) => {
      expect(isApprovalDecisionTransition(from, to)).toBe(false);
    },
  );
});


// A real transactional memory store exercises the portable port without borrowing
// SQL's independent ended_on filter. Successful work commits; rejected work rolls back.
class MemoryOffboardingStore implements OffboardingTransactionPort {
  private facts: OffboardingFacts;
  constructor(facts: OffboardingFacts) { this.facts = structuredClone(facts); }
  snapshot(): OffboardingFacts { return structuredClone(this.facts); }
  async runAtomic<T>(work: (transaction: OffboardingPersistencePort) => Promise<T>): Promise<T> {
    let draft = this.snapshot();
    const value = await work({
      async loadFacts(actionId) {
        if (draft.action.id !== actionId) throw new Error("OFFBOARDING_CONFLICT");
        return structuredClone(draft);
      },
      async complete(result: OffboardingCompletion, command: OffboardingConfirmation) {
        if (draft.request.companyId !== command.companyId || draft.request.id !== result.requestId)
          throw new Error("OFFBOARDING_CONFLICT");
        draft = {
          action: { ...draft.action, status: "confirmed" },
          request: { ...draft.request, state: "deprovisioned" },
          assignments: draft.assignments.map(row => result.assignmentIds.includes(row.id)
            ? { ...row, endedOn: result.endedOn, endReason: result.endReason } : row),
          original: structuredClone(result),
        };
      },
    });
    this.facts = draft;
    return value;
  }
}

function portableOffboardingFacts(endedOn: string | null): OffboardingFacts {
  return {
    action: { id: "action", requestId: "request", vendorAccountId: "account", kind: "remove", mode: "orchestration",
      status: "pending", operation: "deprovision", context: { assignmentIds: ["assignment"], endReason: "left_company",
        requestId: "request", personId: "person", vendorAccountId: "account" } },
    request: { id: "request", companyId: "company", personId: "person", vendorAccountId: "account",
      licenseTypeId: "license", assignmentId: "assignment", state: "offboarding" },
    assignments: [{ id: "assignment", requestId: "request", companyId: "company", personId: "person",
      vendorAccountId: "account", licenseTypeId: "license", startedOn: "2026-07-28", endedOn, endReason: null }],
    original: null,
  };
}

it.each(["closed", "mixed closed", "mixed future start"] as const)("rejects %s portable assignments without relying on SQL constraints", async scenario => {
  const command: OffboardingConfirmation = { actionId: "action", requestId: "request", companyId: "company",
    actorUserId: "actor", confirmationId: "portable-confirmation", confirmedAt: new Date("2026-07-29T05:00:00.000Z") };
  let facts = portableOffboardingFacts(scenario === "closed" ? "2026-07-28" : null);
  if (scenario !== "closed") {
    facts = { ...facts,
      action: { ...facts.action, context: { ...(facts.action.context as Record<string, unknown>), assignmentIds: ["assignment", "second"] } },
      assignments: [...facts.assignments, { ...facts.assignments[0]!, id: "second",
        endedOn: scenario === "mixed closed" ? "2026-07-28" : null,
        startedOn: scenario === "mixed future start" ? "2026-07-30" : "2026-07-28" }],
    };
  }
  const closed = new MemoryOffboardingStore(facts);
  const beforeClosed = closed.snapshot();
  await expect(finalizeOffboarding(command, closed)).rejects.toThrow(/^OFFBOARDING_CONFLICT$/);
  expect(closed.snapshot()).toEqual(beforeClosed);

  const open = new MemoryOffboardingStore(portableOffboardingFacts(null));
  const beforeForeign = open.snapshot();
  await expect(finalizeOffboarding({ ...command, companyId: "foreign-company" }, open)).rejects.toThrow(/^OFFBOARDING_CONFLICT$/);
  expect(open.snapshot()).toEqual(beforeForeign);
  const completed = await finalizeOffboarding(command, open);
  expect(completed).toEqual({ requestId: "request", assignmentIds: ["assignment"], endedOn: "2026-07-29",
    endReason: "left_company", confirmedAt: "2026-07-29T05:00:00.000Z", confirmationId: "portable-confirmation", replayed: false });
  expect(open.snapshot().request.state).toBe("deprovisioned");
  expect(open.snapshot().assignments).toEqual([{ ...beforeForeign.assignments[0], endedOn: "2026-07-29", endReason: "left_company" }]);
  const beforeReplay = open.snapshot();
  expect(await finalizeOffboarding({ ...command, confirmationId: "replay" }, open)).toEqual({ ...completed, replayed: true });
  expect(open.snapshot()).toEqual(beforeReplay);
});
