import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
  REQUEST_STATUS_KIND,
  REQUEST_STATUSES,
  StatusPill,
} from "./status-pill";

describe("StatusPill", () => {
  test("maps all 12 request states to the locked semantic kinds", () => {
    expect(REQUEST_STATUSES).toHaveLength(12);
    expect(REQUEST_STATUS_KIND).toEqual({
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
    });
  });

  test.each([
    ["approved", "success"],
    ["active", "success"],
    ["pending_approval", "pending"],
    ["provisioning", "pending"],
    ["invited", "pending"],
    ["flagged_inactive", "pending"],
    ["blocked_no_seat", "attention"],
    ["failed", "attention"],
    ["rejected", "attention"],
    ["submitted", "neutral"],
    ["offboarding", "neutral"],
    ["deprovisioned", "neutral"],
  ] as const)(
    "renders %s with its exact %s semantic class",
    (status, kind) => {
      const markup = renderToStaticMarkup(
        <StatusPill status={status} label={status} />,
      );

      expect(markup).toContain(
        `class="status-pill status-pill--${kind}"`,
      );
      expect(markup).toContain(`data-status="${status}"`);
      expect(markup).toContain(`>${status}</span>`);
    },
  );
});
