import { beforeEach, expect, test, vi } from "vitest";
import fc from "fast-check";
let saveRateCardSchema: typeof import("./rates").saveRateCardSchema;
beforeEach(async () => {
  vi.resetModules();
  saveRateCardSchema = (await import("./rates")).saveRateCardSchema;
});

const base = { vendorAccountId: "32000000-0000-4000-8000-000000000003",
  licenseTypeId: "32000000-0000-4000-8000-000000000004",
  monthlyRateUsd: "62.00", effectiveFrom: "2026-01-01" };

test("manual evidence defaults to provisional and an open range; exact cents are never rounded", () => {
  const parsed = saveRateCardSchema.parse(base);
  expect(parsed.provisional).toBe(true);
  expect(parsed.effectiveTo).toBeNull();
  for (const monthlyRateUsd of ["0", "1", "62", "62.5", "99999999", "99999999.99"]) {
    expect(saveRateCardSchema.parse({ ...base, monthlyRateUsd }).monthlyRateUsd).toBe(monthlyRateUsd);
  }
  fc.assert(fc.property(fc.integer({ min: 0, max: 9_999_999_999 }), cents => {
    const amount = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
    expect(saveRateCardSchema.parse({ ...base, monthlyRateUsd: amount }).monthlyRateUsd).toBe(amount);
    expect(saveRateCardSchema.safeParse({ ...base, monthlyRateUsd: amount + "1" }).success).toBe(false);
  }), { seed: 32, numRuns: 100 });
});

test("rejects invalid manual amounts, dates, ranges, identifiers and unexpected authority fields", () => {
  for (const monthlyRateUsd of ["-1", "1e2", "NaN", "", ".50", "00.50", "100000000", " 62.00", "1.", "62.00USD", "USD62.00", "1.000"]) {
    expect(saveRateCardSchema.safeParse({ ...base, monthlyRateUsd }).success).toBe(false);
  }
  for (const effectiveFrom of ["2026-02-29", "2026-13-01", "2026-1-01", "not-a-date"]) {
    expect(saveRateCardSchema.safeParse({ ...base, effectiveFrom }).success).toBe(false);
  }
  for (const changes of [{ effectiveTo: "2025-12-31" }, { effectiveTo: "2026-02-30" }, { companyId: "forged" },
    { provisional: "false" }, { id: "not-a-uuid" }, { vendorAccountId: "bad" }, { licenseTypeId: "bad" }]) {
    expect(saveRateCardSchema.safeParse({ ...base, ...changes }).success).toBe(false);
  }
  expect(saveRateCardSchema.parse({ ...base, effectiveFrom: "2024-02-29", effectiveTo: "2024-02-29", provisional: false }).provisional).toBe(false);
  const reversed = saveRateCardSchema.safeParse({ ...base, effectiveTo: "2025-12-31" });
  expect(reversed.success).toBe(false);
  if (!reversed.success) expect(reversed.error.issues.map(issue => issue.path)).toContainEqual(["effectiveTo"]);
});
