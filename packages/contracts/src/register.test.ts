import { beforeEach, expect, test, vi } from "vitest";

let register: typeof import("./register");
let close: typeof import("./close");
beforeEach(async () => {
  vi.resetModules();
  register = await import("./register");
  close = await import("./close");
});

test.each(["2026-10", "2024-02", "1000-01", "9999-12", "2026-09", "2026-11", "2021-01"])(
  "US-098 activeMonth accepts the close period %s",
  (activeMonth) => {
    expect(register.parseRegisterFilters({ activeMonth })).toEqual({ activeMonth });
  },
);

test.each([
  "2026-13", "2026-00", "0000-01", "0999-01", "2026-1", "26-10", "20261-10", "2abc-10", "2026-0a", "2026-1a", "2026-001",
  "2026-10-01", " 2026-10", "x2026-10", "2026-10x", "2026-10 ", "2026/10", "202610", "2026--10", "2026-20", "2026-1-",
])("US-098 activeMonth rejects %j, which the close also rejects", (activeMonth) => {
  expect(() => register.parseRegisterFilters({ activeMonth })).toThrow("Invalid register filters");
  expect(close.runCloseSchema.shape.period.safeParse(activeMonth).success).toBe(false);
});

test("US-098 activeMonth accepts exactly the strings the close's period contract accepts (differential)", () => {
  const years = ["0000", "0999", "1000", "2026", "9999", "202", "20261", "2a26", "x2026"];
  const months = ["00", "01", "09", "10", "12", "13", "19", "20", "1", "001", "1a", "0a"];
  const separators = ["-", "/", "", "--"];
  const suffixes = ["", " ", "x", "-01"];
  const accepted: string[] = [];
  for (const year of years) for (const month of months) for (const separator of separators) for (const suffix of suffixes) {
    const candidate = `${year}${separator}${month}${suffix}`;
    const closeAccepts = close.runCloseSchema.shape.period.safeParse(candidate).success;
    expect(register.createRegisterFiltersSchema().safeParse({ activeMonth: candidate }).success, candidate).toBe(closeAccepts);
    if (closeAccepts) accepted.push(candidate);
  }
  expect(accepted.sort()).toEqual([
    "1000-01", "1000-09", "1000-10", "1000-12",
    "2021-01",
    "2026-01", "2026-09", "2026-10", "2026-12",
    "9999-01", "9999-09", "9999-10", "9999-12",
  ]);
});
