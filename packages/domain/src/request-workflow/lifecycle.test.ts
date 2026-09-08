import { describe, expect, it } from "vitest";

import {
  REQUEST_TRANSITIONS,
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
