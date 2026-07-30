import { describe, expect, it } from "vitest";

import {
  buildChecklistConfirmation,
  buildChecklistFailure,
  checklistSettlement,
} from "./checklist-controller";

describe("US-020 checklist UI controller", () => {
  it("builds stable command payloads without accepting a client date", () => {
    expect(
      buildChecklistConfirmation(
        "action-1",
        "confirmation-1",
      ),
    ).toEqual({
      actionId: "action-1",
      confirmationId: "confirmation-1",
    });
    expect(buildChecklistFailure("action-1", "  no access  ", "failure-1"))
      .toEqual({
        ok: true,
        input: {
          actionId: "action-1",
          failureId: "failure-1",
          reason: "no access",
        },
      });
    expect(buildChecklistFailure("action-1", " ", "failure-1")).toEqual({
      ok: false,
    });
  });

  it("settles exact success and failure outcomes without optimistic assumptions", () => {
    expect(checklistSettlement({ ok: true })).toEqual({ close: true, error: false });
    expect(checklistSettlement({ ok: false, error: "conflict" })).toEqual({
      close: false,
      error: true,
    });
  });
});
