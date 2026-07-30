import { describe, expect, it } from "vitest";

import {
  REQUEST_TRANSITIONS,
  assertLegalTransition,
  isApprovalDecisionTransition,
  type RequestState,
} from "./lifecycle.js";

const EXPECTED_TRANSITIONS = {
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
    expect(ALLOWED_EDGES).toHaveLength(19);
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
