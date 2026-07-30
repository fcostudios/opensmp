import { describe, expect, it } from "vitest";

import {
  parseChecklistPayload,
  parseConfirmChecklist,
  parseFailChecklist,
  parseObservation,
  safeParseChecklistPayload,
  safeParseConfirmChecklist,
  safeParseFailChecklist,
  safeParseObservation,
  validatedChecklistSteps,
} from "@/modules/request-workflow/orchestration-contract";
import {
  validateAutomatedProvisionPayload,
  validateProvisioningActionPlan,
} from "@/modules/request-workflow/orchestration";

const id = (suffix: string) =>
  `32000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const validPayload = {
  checklistSteps: [{
    messageKey: "connector.manual.invite_person",
    params: {
      personEmail: "person@example.com",
      licenseTypeName: "Generic seat",
    },
    targets: {
      requestId: id("1"),
      vendorAccountId: id("2"),
      personId: id("3"),
      licenseId: id("4"),
    },
  }],
  context: {},
  instruction: {
    requestId: id("1"),
    vendorAccountId: id("2"),
    personEmail: "person@example.com",
    licenseTypeName: "Generic seat",
  },
  operation: "provision",
  protocol: "none",
  version: 1,
};

describe("US-020 orchestration wire contracts", () => {
  it("accepts only exact automated provision plans and rejects incompatible planner output", () => {
    const automatedPayload = {
      checklistSteps: [],
      context: { companyId: id("7"), requestId: id("1") },
      instruction: {
        licenseTypeName: "Generic seat",
        personEmail: "person@example.com",
        requestId: id("1"),
        vendorAccountId: id("2"),
      },
      operation: "provision",
      protocol: "rest",
      version: 1,
    };
    for (const protocol of ["rest", "scim"] as const) {
      expect(() =>
        validateAutomatedProvisionPayload({
          ...automatedPayload,
          protocol,
        })
      ).not.toThrow();
    }
    expect(() =>
      validateProvisioningActionPlan({
        kind: "checklist",
        mode: "orchestration",
        rawRequest: validPayload,
        status: "pending",
      })
    ).not.toThrow();
    expect(() =>
      validateProvisioningActionPlan({
        kind: "invite",
        mode: "automated",
        rawRequest: automatedPayload,
        status: "pending",
      })
    ).not.toThrow();

    for (const invalid of [
      { ...automatedPayload, checklistSteps: ["manual"] },
      { ...automatedPayload, operation: "deprovision" },
      { ...automatedPayload, protocol: "none" },
      { ...automatedPayload, version: 2 },
      { ...automatedPayload, extra: true },
      {
        ...automatedPayload,
        context: { ...automatedPayload.context, companyId: "invalid" },
      },
      {
        ...automatedPayload,
        context: { ...automatedPayload.context, extra: true },
      },
      {
        ...automatedPayload,
        instruction: {
          ...automatedPayload.instruction,
          licenseTypeName: " ",
        },
      },
      {
        ...automatedPayload,
        instruction: {
          ...automatedPayload.instruction,
          personEmail: "invalid",
        },
      },
      {
        ...automatedPayload,
        instruction: {
          ...automatedPayload.instruction,
          requestId: "invalid",
        },
      },
      {
        ...automatedPayload,
        instruction: {
          ...automatedPayload.instruction,
          vendorAccountId: "invalid",
        },
      },
      {
        ...automatedPayload,
        instruction: { ...automatedPayload.instruction, extra: true },
      },
    ]) {
      expect(() => validateAutomatedProvisionPayload(invalid)).toThrow();
    }
    for (const invalidPlan of [
      {
        kind: "checklist",
        mode: "automated",
        rawRequest: validPayload,
        status: "pending",
      },
      {
        kind: "invite",
        mode: "orchestration",
        rawRequest: automatedPayload,
        status: "pending",
      },
      {
        kind: "remove",
        mode: "automated",
        rawRequest: automatedPayload,
        status: "pending",
      },
    ]) {
      expect(() =>
        validateProvisioningActionPlan(invalidPlan as never)
      ).toThrow("PROVISIONING_ACTION_PLAN_INVALID");
    }
  });

  it("accepts the canonical complete payload and rejects each unsafe boundary", () => {
    expect(parseChecklistPayload(validPayload)).toEqual(validPayload);
    expect(validatedChecklistSteps(validPayload)).toEqual(
      validPayload.checklistSteps,
    );
    for (const messageKey of [
      "connector.manual.open_vendor_console",
      "connector.manual.invite_person",
      "connector.manual.assign_license",
      "connector.manual.remove_person",
      "connector.manual.revoke_license",
      "connector.manual.confirm_execution",
    ]) {
      expect(parseChecklistPayload({
        ...validPayload,
        checklistSteps: [{
          ...validPayload.checklistSteps[0],
          messageKey,
        }],
      }).checklistSteps[0]?.messageKey).toBe(messageKey);
    }
    for (const operation of ["provision", "deprovision"]) {
      expect(parseChecklistPayload({ ...validPayload, operation }).operation)
        .toBe(operation);
    }
    for (const protocol of ["none", "rest", "scim"]) {
      expect(parseChecklistPayload({ ...validPayload, protocol }).protocol)
        .toBe(protocol);
    }
    for (const invalid of [
      { ...validPayload, checklistSteps: [] },
      { ...validPayload, version: 2 },
      { ...validPayload, operation: "sync" },
      { ...validPayload, protocol: "anthropic" },
      { ...validPayload, extra: true },
      {
        ...validPayload,
        checklistSteps: [{
          ...validPayload.checklistSteps[0],
          messageKey: "unsafe.html",
        }],
      },
      {
        ...validPayload,
        checklistSteps: [{
          ...validPayload.checklistSteps[0],
          params: {
            ...validPayload.checklistSteps[0].params,
            personEmail: "not-email",
          },
        }],
      },
      {
        ...validPayload,
        checklistSteps: [{
          ...validPayload.checklistSteps[0],
          params: {
            ...validPayload.checklistSteps[0].params,
            licenseTypeName: " ",
          },
        }],
      },
      {
        ...validPayload,
        checklistSteps: [{
          ...validPayload.checklistSteps[0],
          targets: {
            ...validPayload.checklistSteps[0].targets,
            requestId: "not-uuid",
          },
        }],
      },
      {
        ...validPayload,
        instruction: { ...validPayload.instruction, personEmail: "not-email" },
      },
      {
        ...validPayload,
        instruction: { ...validPayload.instruction, licenseTypeName: " " },
      },
    ]) {
      expect(safeParseChecklistPayload(invalid).success).toBe(false);
    }
  });

  it("rejects missing, padded, oversized, hostile-date, and wrong-source command fields", () => {
    const confirm = {
      actionId: id("5"),
      confirmationId: "confirm-1",
    };
    expect(parseConfirmChecklist(confirm)).toEqual(confirm);
    for (const invalid of [
      { ...confirm, actionId: "bad" },
      { ...confirm, attestedOn: "1999-01-01" },
      { ...confirm, attestedOn: "2099-01-01" },
      { ...confirm, confirmationId: " " },
      { ...confirm, confirmationId: "x".repeat(201) },
      { ...confirm, extra: true },
    ]) {
      expect(safeParseConfirmChecklist(invalid).success).toBe(false);
    }

    const failure = { actionId: id("5"), failureId: "failure-1", reason: "why" };
    expect(parseFailChecklist(failure)).toEqual(failure);
    expect(safeParseFailChecklist({ ...failure, failureId: " " }).success).toBe(false);
    expect(safeParseFailChecklist({ ...failure, failureId: "x".repeat(201) }).success).toBe(false);
    expect(safeParseFailChecklist({ ...failure, actionId: "bad" }).success).toBe(false);

    const observation = {
      actionId: id("5"),
      observedAssigned: false,
      observedAt: new Date("2026-07-29T15:00:00.000Z"),
      observationId: "observation-1",
      source: "member_sync",
    };
    expect(parseObservation(observation)).toEqual(observation);
    expect(safeParseObservation({ ...observation, source: "manual" }).success).toBe(false);
    expect(safeParseObservation({ ...observation, observationId: " " }).success).toBe(false);
    expect(safeParseObservation({ ...observation, observationId: "x".repeat(201) }).success).toBe(false);
    expect(safeParseObservation({ ...observation, observedAssigned: "false" }).success).toBe(false);
  });
});
