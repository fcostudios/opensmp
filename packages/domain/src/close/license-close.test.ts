import { beforeEach, expect, test, vi } from "vitest";
import fc from "fast-check";
let computeLicenseClose: typeof import("./license-close").computeLicenseClose;
let monthBounds: typeof import("./license-close").monthBounds;
beforeEach(async()=>{vi.resetModules();({computeLicenseClose,monthBounds}=await import("./license-close"));});

const assignment = { id: "a", companyId: "A", personId: "person", vendorAccountId: "org", licenseTypeId: "seat", startedOn: "2020-01-01", endedOn: null };
const rate = { id: "rate", vendorAccountId: "org", licenseTypeId: "seat", monthlyRateUsd: "62.00", effectiveFrom: "2020-01-01", effectiveTo: null, provisional: true };

test("transfer effective the 10th gives A nine days and B twenty-two with dated evidence", () => {
  const lines = computeLicenseClose("2026-01", [{ ...assignment, endedOn: "2026-01-09" }, { ...assignment, id: "b", companyId: "B", startedOn: "2026-01-10" }], [rate]);
  expect(lines.map(l => [l.companyId, l.personId, l.periodFrom, l.periodTo, l.licenseDays, l.amountUsd])).toEqual([
    ["A", "person", "2026-01-01", "2026-01-09", 9, "18.00"], ["B", "person", "2026-01-10", "2026-01-31", 22, "44.00"],
  ]);
  expect(lines[0]).toMatchObject({ assignmentId: "a", vendorAccountId: "org", licenseTypeId: "seat", rateUsd: "62.00", note: "provisional_rate" });
});

test("all month lengths and transfer dates conserve the unsplit charge to the cent", () => {
  fc.assert(fc.property(fc.integer({ min: 2024, max: 2032 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 27 }), fc.integer({ min: 0, max: 99999999 }), (year, month, day, cents) => {
    const period = `${year}-${String(month).padStart(2, "0")}`;
    const bounds = monthBounds(period);
    const from = `${period}-${String(day + 1).padStart(2, "0")}`;
    const to = `${period}-${String(day).padStart(2, "0")}`;
    const priced = { ...rate, monthlyRateUsd: (cents / 100).toFixed(2) };
    const entries = [{ ...assignment, endedOn: to }, { ...assignment, id: "b", companyId: "B", startedOn: from }];
    const lines = computeLicenseClose(period, entries, [priced]);
    expect(lines.reduce((sum, l) => sum + l.licenseDays, 0)).toBe(bounds.days);
    expect(BigInt(lines[0]!.amountUsd.replace(".", ""))).toBe(BigInt(Math.floor(cents * day / bounds.days + 0.5)));
    expect(lines.reduce((sum, l) => sum + BigInt(l.amountUsd.replace(".", "")), 0n)).toBe(BigInt(cents));
    expect(computeLicenseClose(period, entries.reverse(), [priced])).toEqual(lines);
  }), { seed: 34, numRuns: 200 });
});

test("splits at inclusive rate boundaries, clips assignments, ignores other catalogs and outside dates", () => {
  const lines = computeLicenseClose("2024-02", [{ ...assignment, startedOn: "2024-02-09", endedOn: "2024-03-01" }, { ...assignment, id: "outside", endedOn: "2023-12-31" }], [
    { ...rate, effectiveTo: "2024-02-09", monthlyRateUsd: "29.00" },
    { ...rate, id: "next", effectiveFrom: "2024-02-10", monthlyRateUsd: "58.00", provisional: false },
    { ...rate, id: "other", vendorAccountId: "other" }, { ...rate, id: "other-seat", licenseTypeId: "other" },
    { ...rate, id: "future", effectiveFrom: "2024-03-01" }, { ...rate, id: "expired", effectiveTo: "2023-12-31" },
  ].reverse());
  expect(lines.map(l => [l.periodFrom, l.periodTo, l.licenseDays, l.amountUsd, l.note])).toEqual([
    ["2024-02-09", "2024-02-09", 1, "1.00", "provisional_rate"], ["2024-02-10", "2024-02-29", 20, "40.00", null],
  ]);
  expect(computeLicenseClose("2026-01", [], [])).toEqual([]);
});

test("fails closed on missing rates, gaps and overlapping rates", () => {
  for (const rates of [[], [{ ...rate, effectiveFrom: "2026-01-02" }], [{ ...rate, effectiveTo: "2026-01-30" }], [rate, { ...rate, id: "duplicate" }]]) {
    expect(() => computeLicenseClose("2026-01", [assignment], rates)).toThrow("CLOSE_RATE_COVERAGE");
  }
});

test("month bounds reject malformed periods and use real calendar boundaries", () => {
  expect(monthBounds("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29", days: 29 });
  expect(monthBounds("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31", days: 31 });
  for (const period of ["2026-00", "2026-13", "26-01", "2026-1", "2026-01junk", "junk2026-01", "0000-01"]) expect(() => monthBounds(period)).toThrow("CLOSE_INVALID_PERIOD");
});

test("rounding for independent people is unaffected by other people in the same close",()=>{
  fc.assert(fc.property(fc.integer({min:1,max:27}),fc.integer({min:1,max:99999}),fc.integer({min:2,max:8}),(days,cents,count)=>{
    const priced={...rate,monthlyRateUsd:(cents/100).toFixed(2)};
    const assignments=Array.from({length:count},(_,n)=>({...assignment,id:`assignment-${n}`,personId:`person-${n}`,startedOn:"2026-01-01",endedOn:`2026-01-${String(days).padStart(2,"0")}`}));
    const lines=computeLicenseClose("2026-01",assignments,[priced]);
    expect(lines).toHaveLength(count);
    for(const line of lines)expect(BigInt(line.amountUsd.replace(".",""))).toBe(BigInt(Math.floor(cents*days/31+0.5)));
  }),{seed:341,numRuns:100});
  expect(computeLicenseClose("2026-01",[{...assignment,startedOn:"2026-01-01",endedOn:"2026-01-01"}],[{...rate,monthlyRateUsd:"31"}])[0]?.amountUsd).toBe("1.00");
  expect(computeLicenseClose("2026-01",[{...assignment,startedOn:"2026-01-01",endedOn:"2026-01-10"}],[{...rate,monthlyRateUsd:"3.1"}])[0]?.amountUsd).toBe("1.00");
});
