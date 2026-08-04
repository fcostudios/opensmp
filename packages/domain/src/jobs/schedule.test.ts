import { describe, expect, it } from "vitest";

import * as scheduleModule from "./schedule.js";
import {
  JOB_SCHEDULES,
  SCHEDULE_TIME_DOCUMENTATION,
  businessDaysBetween,
  businessDaysElapsedInMonth,
  createJobIdempotencyKey,
  createScheduledJobIdempotencyKey,
  isEcuadorBusinessDayDeadlineOverdue,
  isThirdBusinessDay,
  type EcuadorBusinessCalendar,
} from "./schedule.js";

describe("US-046 job schedules", () => {
  it("exposes a deterministic Ecuador same-business-day deadline evaluator", () => {
    expect(scheduleModule).toHaveProperty("isEcuadorBusinessDayDeadlineOverdue");
  });

  it("breaches exactly at the end of the Ecuador business date", () => {
    const calendar: EcuadorBusinessCalendar = { holidays: new Set() };
    const startedAt = new Date("2026-08-07T20:00:00.000Z");

    expect(
      isEcuadorBusinessDayDeadlineOverdue(
        startedAt,
        new Date("2026-08-08T04:59:59.999Z"),
        calendar,
      ),
    ).toBe(false);
    expect(
      isEcuadorBusinessDayDeadlineOverdue(
        startedAt,
        new Date("2026-08-08T05:00:00.000Z"),
        calendar,
      ),
    ).toBe(true);
  });

  it("assigns weekend and holiday starts to the next Ecuador business date", () => {
    const weekendStart = new Date("2026-08-08T05:01:00.000Z");

    expect(
      isEcuadorBusinessDayDeadlineOverdue(
        weekendStart,
        new Date("2026-08-11T04:59:59.999Z"),
        { holidays: new Set() },
      ),
    ).toBe(false);
    expect(
      isEcuadorBusinessDayDeadlineOverdue(
        weekendStart,
        new Date("2026-08-11T05:00:00.000Z"),
        { holidays: new Set() },
      ),
    ).toBe(true);
    expect(
      isEcuadorBusinessDayDeadlineOverdue(
        weekendStart,
        new Date("2026-08-12T04:59:59.999Z"),
        { holidays: new Set(["2026-08-10"]) },
      ),
    ).toBe(false);
    expect(
      isEcuadorBusinessDayDeadlineOverdue(
        weekendStart,
        new Date("2026-08-12T05:00:00.000Z"),
        { holidays: new Set(["2026-08-10"]) },
      ),
    ).toBe(true);
  });

  it("defines every operational queue with its approved UTC cron schedule", () => {
    expect(JOB_SCHEDULES).toEqual({
      analyticsSync: { cron: "15 10 * * *", queue: "analytics-sync", timeZone: "UTC" },
      memberSync: { cron: "5 * * * *", queue: "member-sync", timeZone: "UTC" },
      invitePoll: { cron: "*/15 * * * *", queue: "invite-poll", timeZone: "UTC" },
      alertEvaluation: {
        cron: "7,22,37,52 * * * *",
        queue: "alert-evaluation",
        timeZone: "UTC",
      },
      closePrecheck: { cron: "30 10 * * 1-5", queue: "close-precheck", timeZone: "UTC" },
      capacityRecovery: { cron: "* * * * *", queue: "capacity-recovery", timeZone: "UTC" },
    });
  });

  it("keeps the America/Guayaquil operator-time equivalents alongside the UTC schedules", () => {
    expect(SCHEDULE_TIME_DOCUMENTATION.analyticsSync.americaGuayaquilCron).toBe("15 5 * * *");
    expect(SCHEDULE_TIME_DOCUMENTATION.memberSync.americaGuayaquilCron).toBe("5 * * * *");
    expect(SCHEDULE_TIME_DOCUMENTATION.invitePoll.americaGuayaquilCron).toBe("*/15 * * * *");
    expect(SCHEDULE_TIME_DOCUMENTATION.alertEvaluation.americaGuayaquilCron).toBe("7,22,37,52 * * * *");
    expect(SCHEDULE_TIME_DOCUMENTATION.closePrecheck.americaGuayaquilCron).toBe("30 5 * * 1-5");
    expect(SCHEDULE_TIME_DOCUMENTATION.capacityRecovery.americaGuayaquilCron).toBe("* * * * *");
  });

  it("derives the approved stable keys from UTC job periods", () => {
    const at = new Date("2026-07-25T14:29:59.999Z");

    expect(createJobIdempotencyKey("analyticsSync", { at, vendorAccountId: "vendor-a" })).toBe(
      "analytics-sync:vendor-a:2026-07-25",
    );
    expect(createJobIdempotencyKey("memberSync", { at, vendorAccountId: "vendor-a" })).toBe(
      "member-sync:vendor-a:2026-07-25T14",
    );
    expect(createJobIdempotencyKey("invitePoll", { at, vendorAccountId: "vendor-a" })).toBe(
      "invite-poll:vendor-a:2026-07-25T14:15",
    );
    expect(createJobIdempotencyKey("alertEvaluation", { at })).toBe(
      "alert-evaluation:2026-07-25T14:15",
    );
    expect(createJobIdempotencyKey("capacityRecovery", { at })).toBe(
      "capacity-recovery:2026-07-25T14:29",
    );
    expect(createJobIdempotencyKey("closePrecheck", { at })).toBe("close-precheck:2026-07");
  });

  it("rejects a vendor-scoped key without its vendor account", () => {
    expect(() => createJobIdempotencyKey("memberSync", { at: new Date("2026-07-25T14:00:00Z") })).toThrow(
      "vendorAccountId is required",
    );
  });

  it("uses coordinator keys only for vendor cohorts and shares global execution keys", () => {
    const at = new Date("2026-07-25T14:29:59.999Z");

    expect(createScheduledJobIdempotencyKey("analyticsSync", { at })).toBe("analytics-sync:scheduled:2026-07-25");
    expect(createScheduledJobIdempotencyKey("memberSync", { at })).toBe("member-sync:scheduled:2026-07-25T14");
    expect(createScheduledJobIdempotencyKey("invitePoll", { at })).toBe("invite-poll:scheduled:2026-07-25T14:15");
    expect(createScheduledJobIdempotencyKey("alertEvaluation", { at })).toBe(
      createJobIdempotencyKey("alertEvaluation", { at }),
    );
    expect(createScheduledJobIdempotencyKey("closePrecheck", { at })).toBe(
      createJobIdempotencyKey("closePrecheck", { at }),
    );
  });

  it("uses configured Ecuador holidays when identifying the third business day", () => {
    const calendar: EcuadorBusinessCalendar = {
      holidays: new Set(["2026-08-03"]),
    };

    expect(isThirdBusinessDay(new Date("2026-08-05T10:30:00Z"), calendar)).toBe(false);
    expect(isThirdBusinessDay(new Date("2026-08-06T10:30:00Z"), calendar)).toBe(true);
    expect(isThirdBusinessDay(new Date("2026-08-08T10:30:00Z"), calendar)).toBe(false);
  });

  it("counts business days deterministically for alert thresholds", () => {
    const calendar: EcuadorBusinessCalendar = {
      holidays: new Set(["2026-08-03"]),
    };

    expect(
      businessDaysElapsedInMonth(new Date("2026-08-06T23:59:59Z"), calendar),
    ).toBe(3);
    expect(
      businessDaysElapsedInMonth(new Date("2026-08-07T05:00:00Z"), calendar),
    ).toBe(4);
    expect(
      businessDaysBetween(
        new Date("2026-08-04T20:00:00Z"),
        new Date("2026-08-06T10:00:00Z"),
        calendar,
      ),
    ).toBe(2);
  });

  it("uses the America/Guayaquil operating date across the UTC-midnight boundary", () => {
    const calendar: EcuadorBusinessCalendar = {
      holidays: new Set(["2026-08-03"]),
    };

    expect(
      businessDaysElapsedInMonth(new Date("2026-08-07T03:30:00Z"), calendar),
    ).toBe(3);
    expect(
      businessDaysElapsedInMonth(new Date("2026-08-07T05:00:00Z"), calendar),
    ).toBe(4);
    expect(
      businessDaysBetween(
        new Date("2026-08-04T04:30:00Z"),
        new Date("2026-08-05T04:30:00Z"),
        calendar,
      ),
    ).toBe(1);
    expect(
      businessDaysBetween(
        new Date("2026-08-07T20:00:00Z"),
        new Date("2026-08-10T20:00:00Z"),
        calendar,
      ),
    ).toBe(1);
  });

  it("keeps four-digit operating years when matching holidays", () => {
    expect(
      businessDaysElapsedInMonth(
        new Date("0001-01-02T12:00:00Z"),
        { holidays: new Set(["0001-01-01"]) },
      ),
    ).toBe(1);
  });
});
