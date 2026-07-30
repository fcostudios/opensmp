import { describe, expect, test } from "vitest";

import {
  personInputSchema,
  startOffboardingInputSchema,
} from "./people";

const companyId = "00000000-0000-0000-0000-000000000101";

describe("personInputSchema", () => {
  test("normalizes the vendor identity fields before returning validated input", () => {
    expect(
      personInputSchema.parse({
        fullName: "  María Andrade  ",
        email: "  MARIA.ANDRADE@EXAMPLE.COM ",
        companyId,
        status: "active",
      }),
    ).toEqual({
      fullName: "María Andrade",
      email: "maria.andrade@example.com",
      companyId,
      status: "active",
      confirmCompanyMove: false,
    });
  });

  test.each([
    ["blank name", { fullName: "   ", email: "a@example.com", companyId, status: "active" }],
    ["invalid email", { fullName: "Andrea", email: "not-an-email", companyId, status: "active" }],
    ["invalid company", { fullName: "Andrea", email: "a@example.com", companyId: "company-a", status: "active" }],
    ["invalid status", { fullName: "Andrea", email: "a@example.com", companyId, status: "inactive" }],
  ])("rejects %s", (_case, input) => {
    expect(personInputSchema.safeParse(input).success).toBe(false);
  });
});

describe("startOffboardingInputSchema", () => {
  test("accepts only an identified person, exhaustive reason, and trimmed audit note", () => {
    expect(
      startOffboardingInputSchema.parse({
        personId: companyId,
        endReason: "left_company",
        note: "  Confirmed by People Ops  ",
      }),
    ).toEqual({
      personId: companyId,
      endReason: "left_company",
      note: "Confirmed by People Ops",
    });
    expect(
      startOffboardingInputSchema.safeParse({
        personId: companyId,
        endReason: "unknown",
        note: "Confirmed",
      }).success,
    ).toBe(false);
    expect(
      startOffboardingInputSchema.safeParse({
        personId: companyId,
        endReason: "inactive",
        note: "   ",
      }).success,
    ).toBe(false);
  });
});
