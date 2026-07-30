import { describe, expect, it } from "vitest";

import {
  checklistFailureReasonLabel,
  checklistExceptionStatusLabel,
  checklistRequestHref,
} from "./checklist-exception-presenter";

const validRequestId = "32000000-0000-4000-8000-000000000008";
const validUuidV7 = "0190c8b0-7e11-7cc3-98c8-0242ac120002";

describe("checklist exception presenter", () => {
  it("maps both persisted failure states to their localized labels", () => {
    const labels = {
      failed: "Fallida",
      verificationFailed: "Verificación fallida",
    };
    expect(checklistExceptionStatusLabel("failed", labels)).toBe("Fallida");
    expect(checklistExceptionStatusLabel("verification_failed", labels)).toBe(
      "Verificación fallida",
    );
  });

  it("builds a request-detail link for canonical UUIDv4 and UUIDv7 identifiers", () => {
    expect(checklistRequestHref(validRequestId)).toBe(
      `/solicitudes/${validRequestId}`,
    );
    expect(checklistRequestHref(validUuidV7)).toBe(
      `/solicitudes/${validUuidV7}`,
    );
    for (const invalid of [
      `x${validRequestId}`,
      `${validRequestId}x`,
      "3-0000-4000-8000-000000000008",
      "!2000000-0000-4000-8000-000000000008",
      "32000000-0-4000-8000-000000000008",
      "32000000-!000-4000-8000-000000000008",
      "32000000-0000-0000-8000-000000000008",
      "32000000-0000-!000-8000-000000000008",
      "32000000-0000-4-8000-000000000008",
      "32000000-0000-4000-0000-000000000008",
      "32000000-0000-4000-!000-000000000008",
      "32000000-0000-4000-8-000000000008",
      "32000000-0000-4000-8000-0",
      "32000000-0000-4000-8000-!00000000008",
    ]) {
      expect(checklistRequestHref(invalid), invalid).toBeNull();
    }
  });

  it("localizes the stable assignment-missing code and preserves unknown forensic reasons", () => {
    const labels = {
      assignmentMissing: "Member synchronization did not find the attested active assignment.",
    };
    expect(
      checklistFailureReasonLabel(
        "checklist_assignment_missing|No matching assignment row for observation member-sync-7.",
        labels,
      ),
    ).toBe(
      "Member synchronization did not find the attested active assignment.",
    );
    expect(
      checklistFailureReasonLabel("Provider rejected invitation INV-42.", labels),
    ).toBe("Provider rejected invitation INV-42.");
  });
});
