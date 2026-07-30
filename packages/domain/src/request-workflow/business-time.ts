import type { EcuadorBusinessCalendar } from "../jobs/schedule.js";
export type { EcuadorBusinessCalendar } from "../jobs/schedule.js";

export type CoveredEcuadorBusinessCalendar = EcuadorBusinessCalendar & {
  readonly coveredYears: ReadonlySet<number>;
};

export function createCoveredEcuadorCalendar(
  holidaysByYear: Readonly<Record<number, readonly string[]>>,
): CoveredEcuadorBusinessCalendar {
  const coveredYears = new Set(
    Object.keys(holidaysByYear).map((year) => Number(year)),
  );
  const holidays = new Set<string>();
  for (const [yearText, dates] of Object.entries(holidaysByYear)) {
    const year = Number(yearText);
    for (const date of dates) {
      if (!date.startsWith(`${year}-`) || !isIsoDate(date)) {
        throw new TypeError(`INVALID_ECUADOR_HOLIDAY:${date}`);
      }
      holidays.add(date);
    }
  }
  return { coveredYears, holidays };
}

export function businessHoursPending(
  since: Date,
  now: Date,
  calendar: CoveredEcuadorBusinessCalendar,
): number {
  const start = new Date(since);
  const end = new Date(now);
  assertCalendarCoverage(start, end, calendar);
  let hours = 0;
  for (
    let cursor = start;
    cursor < end;
    cursor = new Date(cursor.getTime() + 60 * 60 * 1_000)
  ) {
    const weekday = cursor.getUTCDay();
    const isoDate = cursor.toISOString().slice(0, 10);
    if (
      weekday !== 0 &&
      weekday !== 6 &&
      !calendar.holidays.has(isoDate)
    ) {
      hours += 1;
    }
  }
  return hours;
}

export function businessDaysPending(
  since: Date,
  now: Date,
  calendar: CoveredEcuadorBusinessCalendar,
): number {
  return businessHoursPending(since, now, calendar) / 24;
}

function assertCalendarCoverage(
  since: Date,
  now: Date,
  calendar: CoveredEcuadorBusinessCalendar,
): void {
  if (now <= since) return;
  for (
    let year = since.getUTCFullYear();
    year <= now.getUTCFullYear();
    year += 1
  ) {
    if (!calendar.coveredYears.has(year)) {
      throw new TypeError(`ECUADOR_CALENDAR_COVERAGE_MISSING:${year}`);
    }
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

export function hasDecisionTargetBreach(
  pendingBusinessHours: number,
  targetBusinessHours: number,
): boolean {
  return pendingBusinessHours > targetBusinessHours;
}
