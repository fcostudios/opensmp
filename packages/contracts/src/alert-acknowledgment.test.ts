import { describe, expect, it } from "vitest";

import { ackAlertSchema } from "./alert-acknowledgment";

describe("ackAlertSchema", () => {
  it("accepts a uuid alert event id", () => {
    const parsed = ackAlertSchema.parse({
      alertEventId: "00000000-0000-4000-8000-000000004301",
    });
    expect(parsed).toEqual({
      alertEventId: "00000000-0000-4000-8000-000000004301",
    });
  });

  it("rejects a non-uuid id", () => {
    expect(ackAlertSchema.safeParse({ alertEventId: "al-001" }).success).toBe(false);
  });

  it("rejects unknown fields so a caller cannot smuggle an actor", () => {
    const result = ackAlertSchema.safeParse({
      alertEventId: "00000000-0000-4000-8000-000000004301",
      acknowledgedBy: "00000000-0000-4000-8000-000000004999",
    });
    expect(result.success).toBe(false);
  });
});
