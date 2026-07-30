import {
  ecuadorOperatingDate,
  type EcuadorBusinessCalendar,
} from "../jobs/schedule.js";

export type ApprovalAgingThreshold = {
  reminderBusinessHours: 24;
  escalationBusinessHours: 48;
};

export type ApprovalAgingRuntimeThreshold = {
  reminderBusinessHours: number;
  escalationBusinessHours: number;
};

export type ApprovalAgingStage = "reminder" | "escalation";

class ApprovalAgingThresholdValue implements ApprovalAgingThreshold {
  readonly reminderBusinessHours = 24;
  readonly escalationBusinessHours = 48;
}

export const APPROVAL_AGING_THRESHOLD: ApprovalAgingThreshold =
  Object.freeze(new ApprovalAgingThresholdValue());

export function evaluateApprovalAging(input: {
  calendar: EcuadorBusinessCalendar;
  clock: { now(): Date };
  emittedStages: ReadonlySet<ApprovalAgingStage>;
  pendingSince: Date;
  threshold: ApprovalAgingRuntimeThreshold;
}): ApprovalAgingStage[] {
  const elapsedHours = ecuadorBusinessHoursBetween(
    input.pendingSince,
    input.clock.now(),
    input.calendar,
  );
  const stages: ApprovalAgingStage[] = [];
  if (
    elapsedHours >= input.threshold.reminderBusinessHours &&
    !input.emittedStages.has("reminder")
  ) {
    stages.push("reminder");
  }
  if (
    elapsedHours >= input.threshold.escalationBusinessHours &&
    !input.emittedStages.has("escalation")
  ) {
    stages.push("escalation");
  }
  return stages;
}

function ecuadorBusinessHoursBetween(
  since: Date,
  through: Date,
  calendar: EcuadorBusinessCalendar,
): number {
  const start = since.getTime();
  const end = through.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new TypeError("approval aging dates must be valid");
  }
  let cursor = start;
  let elapsedMilliseconds = 0;
  while (cursor < end) {
    const operatingDate = ecuadorOperatingDate(new Date(cursor));
    const nextDate = new Date(`${operatingDate}T00:00:00.000Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const nextOperatingMidnight =
      new Date(`${nextDate.toISOString().slice(0, 10)}T05:00:00.000Z`).getTime();
    const segmentEnd = Math.min(end, nextOperatingMidnight);
    const weekday = new Date(`${operatingDate}T00:00:00.000Z`).getUTCDay();
    if (
      weekday !== 0 &&
      weekday !== 6 &&
      !calendar.holidays.has(operatingDate)
    ) {
      elapsedMilliseconds += segmentEnd - cursor;
    }
    cursor = segmentEnd;
  }
  return elapsedMilliseconds / 3_600_000;
}
