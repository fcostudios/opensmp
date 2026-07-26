import { describe, expect, it } from "vitest";

import {
  JOB_SCHEDULES,
  SCHEDULE_TIME_DOCUMENTATION,
  createJobIdempotencyKey,
  createScheduledJobIdempotencyKey,
  isThirdBusinessDay,
  type EcuadorBusinessCalendar,
} from "./schedule.js";

describe("US-046 job schedules", () => {
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
    });
  });

  it("keeps the America/Guayaquil operator-time equivalents alongside the UTC schedules", () => {
    expect(SCHEDULE_TIME_DOCUMENTATION.analyticsSync.americaGuayaquilCron).toBe("15 5 * * *");
    expect(SCHEDULE_TIME_DOCUMENTATION.memberSync.americaGuayaquilCron).toBe("5 * * * *");
    expect(SCHEDULE_TIME_DOCUMENTATION.invitePoll.americaGuayaquilCron).toBe("*/15 * * * *");
    expect(SCHEDULE_TIME_DOCUMENTATION.alertEvaluation.americaGuayaquilCron).toBe("7,22,37,52 * * * *");
    expect(SCHEDULE_TIME_DOCUMENTATION.closePrecheck.americaGuayaquilCron).toBe("30 5 * * 1-5");
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
});
