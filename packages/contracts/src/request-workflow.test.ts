import { describe, expect, test } from "vitest";

import {
  createDecideRequestSchema,
  decideRequestSchema,
} from "./request-workflow.js";

describe("decideRequestSchema", () => {
  test("accepts approval without a comment", () => {
    expect(
      createDecideRequestSchema().parse({
        requestId: "00000000-0000-0000-0000-000000000001",
        decision: "approved",
      }),
    ).toEqual({
      requestId: "00000000-0000-0000-0000-000000000001",
      decision: "approved",
    });
  });

  test.each(["", "  \n "])(
    "rejects a rejection with an empty comment",
    (decisionComment) => {
      expect(
        decideRequestSchema.safeParse({
          requestId: "00000000-0000-0000-0000-000000000001",
          decision: "rejected",
          decisionComment,
        }).success,
      ).toBe(false);
    },
  );

  test("accepts and trims a meaningful rejection comment", () => {
    expect(
      createDecideRequestSchema().parse({
        requestId: "00000000-0000-0000-0000-000000000001",
        decision: "rejected",
        decisionComment: "  A detailed reason  ",
      }),
    ).toEqual({
      requestId: "00000000-0000-0000-0000-000000000001",
      decision: "rejected",
      decisionComment: "A detailed reason",
    });
  });

  test("accepts and trims a meaningful optional approval comment", () => {
    expect(
      createDecideRequestSchema().parse({
        requestId: "00000000-0000-0000-0000-000000000001",
        decision: "approved",
        decisionComment: "  Approved after budget review  ",
      }),
    ).toEqual({
      requestId: "00000000-0000-0000-0000-000000000001",
      decision: "approved",
      decisionComment: "Approved after budget review",
    });
  });

  test.each([
    {
      requestId: "not-a-uuid",
      decision: "approved",
    },
    {
      requestId: "00000000-0000-0000-0000-000000000001",
      decision: "pending",
    },
    {
      requestId: "00000000-0000-0000-0000-000000000001",
      decision: "approved",
      unexpected: true,
    },
  ])("rejects malformed or non-strict decision input %#", (input) => {
    expect(createDecideRequestSchema().safeParse(input).success).toBe(false);
  });
});
