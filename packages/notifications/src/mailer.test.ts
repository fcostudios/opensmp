import { describe, expect, it } from "vitest";

import { createStableMessageId } from "./mailer.js";

describe("US-042 SMTP retry identity", () => {
  it("derives a stable RFC Message-ID from the event dedupe key", () => {
    expect(createStableMessageId("rule:breach:subject:2026-07-27T15:00:00Z")).toBe(
      "<fb744c475c1dd56a060371d0e6ded5736a69a034a60be52efc7dd22ea4ff625a@ledger.local>",
    );
    expect(createStableMessageId("rule:breach:subject:2026-07-27T15:00:00Z")).toBe(
      createStableMessageId("rule:breach:subject:2026-07-27T15:00:00Z"),
    );
  });
});
