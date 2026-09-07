import { describe, expect, it } from "vitest";

import { parseAutomatedRestProvisionPayload } from "./automated-provisioning";

const ids = {
  account: "26300000-0000-4000-8000-000000000007",
  company: "26300000-0000-4000-8000-000000000002",
  request: "26300000-0000-4000-8000-000000000010",
};

const valid = {
  checklistSteps: [],
  context: { companyId: ids.company, requestId: ids.request },
  instruction: {
    licenseTypeName: "Claude seat",
    personEmail: "person@example.test",
    requestId: ids.request,
    vendorAccountId: ids.account,
  },
  operation: "provision",
  protocol: "rest",
  version: 1,
};

describe("automated REST provisioning payload", () => {
  it("accepts only the exact canonical payload and returns normalized strings", () => {
    expect(parseAutomatedRestProvisionPayload({
      ...valid,
      instruction: {
        ...valid.instruction,
        licenseTypeName: "  Claude seat  ",
        personEmail: "PERSON@EXAMPLE.TEST",
      },
    })).toEqual({
      ...valid,
      instruction: {
        ...valid.instruction,
        licenseTypeName: "Claude seat",
        personEmail: "person@example.test",
      },
    });
  });

  it("rejects every unsafe structural, identity, and protocol boundary", () => {
    const invalid = [
      null,
      [],
      { ...valid, extra: true },
      { ...valid, checklistSteps: [{}] },
      { ...valid, context: { ...valid.context, extra: true } },
      { ...valid, context: { ...valid.context, companyId: "invalid" } },
      { ...valid, context: { ...valid.context, requestId: "invalid" } },
      { ...valid, instruction: { ...valid.instruction, extra: true } },
      { ...valid, instruction: { ...valid.instruction, requestId: "invalid" } },
      { ...valid, instruction: { ...valid.instruction, vendorAccountId: "invalid" } },
      { ...valid, instruction: { ...valid.instruction, licenseTypeName: "   " } },
      { ...valid, instruction: { ...valid.instruction, personEmail: "invalid" } },
      { ...valid, operation: "deprovision" },
      { ...valid, protocol: "scim" },
      { ...valid, version: 2 },
    ];
    for (const candidate of invalid) {
      expect(() => parseAutomatedRestProvisionPayload(candidate)).toThrow();
    }
  });
});
