import { describe, expect, test } from "vitest";

import { createSubmitRequestSchema } from "@smp/contracts/requests";

const base = {
  clientRequestId: "10000000-0000-4000-8000-000000000004",
  requestFor: "self",
  vendorAccountId: "10000000-0000-0000-0000-000000000001",
  licenseTypeId: "10000000-0000-0000-0000-000000000002",
  justification: "Required for customer research",
};

describe("submitRequestSchema", () => {
  test("accepts self-service without client-controlled identity fields", () => {
    expect(createSubmitRequestSchema().parse(base)).toEqual(base);
  });

  test("requires a complete on-behalf identity and normalizes its email", () => {
    expect(
      createSubmitRequestSchema().parse({
        ...base,
        requestFor: "on_behalf",
        personEmail: "  MEMBER@EXAMPLE.TEST ",
        personFullName: " Member Name ",
        personCompanyId: "10000000-0000-0000-0000-000000000003",
        neededBy: "2026-08-17",
      }),
    ).toEqual({
      ...base,
      requestFor: "on_behalf",
      personEmail: "member@example.test",
      personFullName: "Member Name",
      personCompanyId: "10000000-0000-0000-0000-000000000003",
      neededBy: "2026-08-17",
    });
  });

  test.each([
    { ...base, companyId: "10000000-0000-0000-0000-000000000003" },
    { ...base, personEmail: "spoof@example.test" },
    { ...base, neededBy: "2026-02-30" },
    { ...base, justification: " " },
    { ...base, requestFor: "on_behalf" },
    { ...base, requestFor: "other" },
    { ...base, neededBy: "x2026-08-17" },
    { ...base, neededBy: "2026-08-17x" },
    { ...base, neededBy: "x026-08-17" },
    { ...base, neededBy: "2026-x8-17" },
    { ...base, neededBy: "2026-08-x7" },
    { ...base, justification: "x".repeat(2_001) },
    { ...base, vendorAccountId: undefined },
    { ...base, licenseTypeId: undefined },
    { ...base, clientRequestId: undefined },
    { ...base, clientRequestId: "retry-1" },
    {
      ...base,
      requestFor: "on_behalf",
      personEmail: " member@example.test ",
      personFullName: " ",
      personCompanyId: "10000000-0000-0000-0000-000000000003",
    },
    {
      ...base,
      requestFor: "on_behalf",
      personEmail: " member@example.test ",
      personFullName: "x".repeat(201),
      personCompanyId: "10000000-0000-0000-0000-000000000003",
    },
  ])("rejects malformed or client-controlled input %#", (input) => {
    expect(() => createSubmitRequestSchema().parse(input)).toThrow();
  });

  test("preserves meaningful whitespace inside values but trims their edges", () => {
    expect(
      createSubmitRequestSchema().parse({
        ...base,
        justification: "  two words  ",
      }).justification,
    ).toBe("two words");
  });
});
