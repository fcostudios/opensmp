import { expect, test, vi } from "vitest";

const id = "00000000-0000-4000-8000-000000000001";
const record = { personId: id, companyId: id, vendorAccountId: id, licenseTypeId: id, startedOn: "2026-10-01", note: "  Pilot roster  " };

test("manual inputs require real dates, identifiers and a nonblank bounded note", async () => {
  vi.resetModules();
  const { recordManualAssignmentSchema, closeManualAssignmentSchema, parseRegisterFilters } = await import("./register");
  for (const sourceKind of ["request", "import", "reconciliation", "manual"]) {
    expect(parseRegisterFilters({ sourceKind }).sourceKind).toBe(sourceKind);
  }
  expect(recordManualAssignmentSchema.parse(record).note).toBe("Pilot roster");
  for (const patch of [{ note: "  " }, { note: "x".repeat(2001) }, { startedOn: "2026-02-30" }, { startedOn: "2026-1-01" }, { companyId: "other" }, { personId: "" }, { vendorAccountId: "" }, { licenseTypeId: "" }, { role: "group_admin" }]) {
    expect(recordManualAssignmentSchema.safeParse({ ...record, ...patch }).success).toBe(false);
  }
  const close = { assignmentId: id, endedOn: "2026-10-31", endReason: "left_company", note: "Departure" };
  expect(closeManualAssignmentSchema.parse(close)).toEqual(close);
  for (const endReason of ["left_company", "inactive", "reallocated"]) {
    expect(closeManualAssignmentSchema.parse({ ...close, endReason }).endReason).toBe(endReason);
  }
  for (const patch of [{ note: "" }, { endedOn: "2026-02-30" }, { endReason: "other" }, { assignmentId: "other" }]) {
    expect(closeManualAssignmentSchema.safeParse({ ...close, ...patch }).success).toBe(false);
  }
});
