import { describe, expect, it } from "vitest";

import {
  capacityChangeSchema,
  capacityDecisionEvidenceSchema,
  capacityRecoveryJobSchema,
} from "./capacity";
import {
  capacityChangeSchema as publicCapacityChangeSchema,
  capacityDecisionEvidenceSchema as publicCapacityDecisionEvidenceSchema,
  capacityRecoveryJobSchema as publicCapacityRecoveryJobSchema,
} from "./index";

const ids = {
  account: "23000000-0000-4000-8000-000000000001",
  license: "23000000-0000-4000-8000-000000000002",
};

describe("US-023 capacity contracts", () => {
  it("publishes the exact capacity contracts from the public barrel", () => {
    expect(publicCapacityChangeSchema).toBe(capacityChangeSchema);
    expect(publicCapacityDecisionEvidenceSchema).toBe(capacityDecisionEvidenceSchema);
    expect(publicCapacityRecoveryJobSchema).toBe(capacityRecoveryJobSchema);
    expect(publicCapacityChangeSchema.safeParse({ purchasedQty: 1 }).success).toBe(
      false,
    );
  });

  it("kills accepting negative or fractional purchased totals and a missing license type", () => {
    const base = {
      effectiveFrom: "2026-08-04",
      purchasedQty: 4,
      reason: "purchase",
      vendorAccountId: ids.account,
      licenseTypeId: ids.license,
    } as const;

    expect(capacityChangeSchema.parse(base)).toEqual(base);
    expect(capacityChangeSchema.safeParse({ ...base, purchasedQty: -1 }).success).toBe(false);
    expect(capacityChangeSchema.safeParse({ ...base, purchasedQty: 1.5 }).success).toBe(false);
    const { licenseTypeId: _licenseTypeId, ...missingLicense } = base;
    expect(capacityChangeSchema.safeParse(missingLicense).success).toBe(false);
  });

  it("kills malformed dates, identifiers, reasons, and audit notes", () => {
    const base = {
      effectiveFrom: "2026-08-04",
      licenseTypeId: ids.license,
      purchasedQty: 4,
      reason: "purchase",
      vendorAccountId: ids.account,
    } as const;
    for (const effectiveFrom of ["0001-01-01", "2000-02-29", "9999-12-31"]) {
      expect(
        capacityChangeSchema.safeParse({ ...base, effectiveFrom }).success,
      ).toBe(true);
    }
    for (const effectiveFrom of [
      "x2026-08-04",
      "2026-08-04x",
      "206-08-04",
      "abcd-08-04",
      "2026-8-04",
      "2026-ab-04",
      "2026-08-4",
      "2026-08-ab",
      "2026-02-30",
    ]) {
      expect(
        capacityChangeSchema.safeParse({ ...base, effectiveFrom }).success,
      ).toBe(false);
    }
    expect(
      capacityChangeSchema.safeParse({ ...base, vendorAccountId: "not-a-uuid" })
        .success,
    ).toBe(false);
    expect(
      capacityChangeSchema.safeParse({ ...base, reason: "other" }).success,
    ).toBe(false);
    expect(
      capacityChangeSchema.safeParse({ ...base, note: "   " }).success,
    ).toBe(false);
    expect(
      capacityChangeSchema.safeParse({ ...base, note: "x".repeat(1_001) })
        .success,
    ).toBe(false);
    expect(capacityChangeSchema.parse({ ...base, note: "  ordered  " }).note).toBe(
      "ordered",
    );
    expect(capacityChangeSchema.parse({ ...base, reason: "correction" }).reason).toBe(
      "correction",
    );
  });

  it("kills accepting client-supplied company authority", () => {
    expect(
      capacityChangeSchema.safeParse({
        companyId: "23000000-0000-4000-8000-000000000003",
        effectiveFrom: "2026-08-04",
        licenseTypeId: ids.license,
        purchasedQty: 4,
        reason: "correction",
        vendorAccountId: ids.account,
      }).success,
    ).toBe(false);
  });

  it("kills recovery messages that omit the effective-dated capacity identity", () => {
    const payload = {
      capacityId: "23000000-0000-4000-8000-000000000004",
      effectiveFrom: "2026-08-04",
      licenseTypeId: ids.license,
      publishedAt: "2026-08-04T15:00:00.000Z",
      vendorAccountId: ids.account,
    } as const;
    expect(capacityRecoveryJobSchema.parse(payload)).toEqual(payload);
    const { capacityId: _capacityId, ...withoutIdentity } = payload;
    expect(capacityRecoveryJobSchema.safeParse(withoutIdentity).success).toBe(false);
    expect(
      capacityRecoveryJobSchema.safeParse({
        ...payload,
        companyIds: ["23000000-0000-4000-8000-000000000003"],
      }).success,
    ).toBe(false);
    expect(
      capacityRecoveryJobSchema.safeParse({
        ...payload,
        publishedAt: "2026-08-04T15:00:00",
      }).success,
    ).toBe(false);
  });

  it("kills manufacturing zero-valued analytics candidates before US-027", () => {
    expect(capacityDecisionEvidenceSchema.parse({ type: "no_data" })).toEqual({ type: "no_data" });
    expect(
      capacityDecisionEvidenceSchema.safeParse({
        type: "candidates",
        items: [{ assignmentId: ids.account, lastActiveOn: null, monthlyCostUsd: 0 }],
      }).success,
    ).toBe(false);
    const candidate = {
      assignmentId: ids.account,
      lastActiveOn: "2026-08-04",
      monthlyCostUsd: 1,
    } as const;
    expect(
      capacityDecisionEvidenceSchema.parse({
        type: "candidates",
        items: [candidate, { ...candidate, assignmentId: ids.license }],
      }),
    ).toEqual({
      type: "candidates",
      items: [candidate, { ...candidate, assignmentId: ids.license }],
    });
    expect(
      capacityDecisionEvidenceSchema.safeParse({ type: "candidates", items: [] })
        .success,
    ).toBe(false);
    expect(capacityDecisionEvidenceSchema.safeParse({ type: "unknown" }).success).toBe(
      false,
    );
  });
});
