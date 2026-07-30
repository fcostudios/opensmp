import { describe, expect, test } from "vitest";

import {
  businessDaysPending,
  businessHoursPending,
  createCoveredEcuadorCalendar,
  hasDecisionTargetBreach,
} from "./business-time.js";

const ecuadorCalendar = createCoveredEcuadorCalendar({
  2026: ["2026-08-10"],
});

describe("Ecuador approval aging", () => {
  test("counts July 24 through July 28 as two business days", () => {
    const since = new Date("2026-07-24T15:00:00.000Z");
    const now = new Date("2026-07-28T15:00:00.000Z");

    expect(businessHoursPending(since, now, ecuadorCalendar)).toBe(48);
    expect(businessDaysPending(since, now, ecuadorCalendar)).toBe(2);
  });

  test("excludes Ecuador holidays as well as weekends", () => {
    expect(
      businessHoursPending(
        new Date("2026-08-07T15:00:00.000Z"),
        new Date("2026-08-11T15:00:00.000Z"),
        ecuadorCalendar,
      ),
    ).toBe(24);
  });

  test("breaches only after the two-business-day target", () => {
    expect(hasDecisionTargetBreach(48, 48)).toBe(false);
    expect(hasDecisionTargetBreach(49, 48)).toBe(true);
  });

  test("returns zero for an empty or reversed interval", () => {
    const at = new Date("2026-07-28T15:00:00.000Z");
    expect(businessHoursPending(at, at, ecuadorCalendar)).toBe(0);
    expect(
      businessHoursPending(
        at,
        new Date("2026-07-28T14:00:00.000Z"),
        ecuadorCalendar,
      ),
    ).toBe(0);
  });

  test("uses maintained coverage across a December to January boundary", () => {
    const calendar = createCoveredEcuadorCalendar({
      2026: [],
      2027: ["2027-01-01"],
    });

    expect(
      businessHoursPending(
        new Date("2026-12-31T00:00:00.000Z"),
        new Date("2027-01-04T00:00:00.000Z"),
        calendar,
      ),
    ).toBe(24);
  });

  test("excludes a configured Ecuador holiday beyond 2026", () => {
    const calendar = createCoveredEcuadorCalendar({
      2027: ["2027-02-08"],
    });

    expect(
      businessHoursPending(
        new Date("2027-02-08T00:00:00.000Z"),
        new Date("2027-02-09T00:00:00.000Z"),
        calendar,
      ),
    ).toBe(0);
  });

  test("fails closed when the provider does not cover every UTC year", () => {
    const calendar = createCoveredEcuadorCalendar({ 2026: [] });

    expect(() =>
      businessHoursPending(
        new Date("2026-12-31T00:00:00.000Z"),
        new Date("2027-01-02T00:00:00.000Z"),
        calendar,
      ),
    ).toThrow("ECUADOR_CALENDAR_COVERAGE_MISSING:2027");
  });

  test.each([
    [{ 2027: ["2026-12-31"] }, "2026-12-31"],
    [{ 2027: ["2027-2-08"] }, "2027-2-08"],
    [{ 2027: ["x2027-02-08"] }, "x2027-02-08"],
    [{ 2027: ["2027-x2027-02-08"] }, "2027-x2027-02-08"],
    [{ 2027: ["2027-02-08x"] }, "2027-02-08x"],
    [{ 2027: ["2027-02-30"] }, "2027-02-30"],
  ] as const)("rejects an invalid maintained holiday %#", (input, date) => {
    expect(() => createCoveredEcuadorCalendar(input)).toThrow(
      `INVALID_ECUADOR_HOLIDAY:${date}`,
    );
  });

  test("does not require calendar coverage for an empty interval", () => {
    const at = new Date("2028-01-01T00:00:00.000Z");
    expect(
      businessHoursPending(
        at,
        at,
        createCoveredEcuadorCalendar({ 2027: [] }),
      ),
    ).toBe(0);
  });
});
