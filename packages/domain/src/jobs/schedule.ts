export const JOB_SCHEDULES = {
  analyticsSync: { cron: "15 10 * * *", queue: "analytics-sync", timeZone: "UTC" },
  memberSync: { cron: "5 * * * *", queue: "member-sync", timeZone: "UTC" },
  invitePoll: { cron: "*/15 * * * *", queue: "invite-poll", timeZone: "UTC" },
  alertEvaluation: {
    cron: "7,22,37,52 * * * *",
    queue: "alert-evaluation",
    timeZone: "UTC",
  },
  closePrecheck: { cron: "30 10 * * 1-5", queue: "close-precheck", timeZone: "UTC" },
} as const;

/**
 * Mainland Ecuador is permanently UTC-5, so these are the operator-facing cron
 * equivalents of the UTC schedules above. Galápagos is intentionally out of scope.
 */
export const SCHEDULE_TIME_DOCUMENTATION = {
  analyticsSync: { americaGuayaquilCron: "15 5 * * *" },
  memberSync: { americaGuayaquilCron: "5 * * * *" },
  invitePoll: { americaGuayaquilCron: "*/15 * * * *" },
  alertEvaluation: { americaGuayaquilCron: "7,22,37,52 * * * *" },
  closePrecheck: { americaGuayaquilCron: "30 5 * * 1-5" },
} as const satisfies Record<keyof typeof JOB_SCHEDULES, { americaGuayaquilCron: string }>;

export type JobName = keyof typeof JOB_SCHEDULES;

export type EcuadorBusinessCalendar = {
  /** ISO (UTC) calendar dates supplied by the Ecuador operating calendar. */
  holidays: ReadonlySet<string>;
};

type JobKeyInput = {
  at: Date;
  vendorAccountId?: string;
};

const VENDOR_SCOPED_JOBS = new Set<JobName>(["analyticsSync", "memberSync", "invitePoll"]);
// Mainland Ecuador (America/Guayaquil) is permanently UTC-05:00.
const ECUADOR_OFFSET_MS = 18_000_000;

export function createJobIdempotencyKey(job: JobName, input: JobKeyInput): string {
  const date = requireValidDate(input.at);
  const day = utcDate(date);

  if (VENDOR_SCOPED_JOBS.has(job)) {
    const vendorAccountId = requireVendorAccountId(input.vendorAccountId);
    if (job === "analyticsSync") return `analytics-sync:${vendorAccountId}:${day}`;
    if (job === "memberSync") return `member-sync:${vendorAccountId}:${utcHour(date)}`;
    return `invite-poll:${vendorAccountId}:${utcQuarterHour(date)}`;
  }

  if (job === "alertEvaluation") return `alert-evaluation:${utcQuarterHour(date)}`;
  return `close-precheck:${day.slice(0, 7)}`;
}

/**
 * Cron entries coordinate a whole vendor cohort, so they must not impersonate
 * an individual vendor execution. Child jobs use createJobIdempotencyKey with
 * their real vendorAccountId instead.
 */
export function createScheduledJobIdempotencyKey(job: JobName, input: Pick<JobKeyInput, "at">): string {
  const date = requireValidDate(input.at);
  const day = utcDate(date);

  if (job === "analyticsSync") return `analytics-sync:scheduled:${day}`;
  if (job === "memberSync") return `member-sync:scheduled:${utcHour(date)}`;
  if (job === "invitePoll") return `invite-poll:scheduled:${utcQuarterHour(date)}`;
  return createJobIdempotencyKey(job, { at: date });
}

export function isThirdBusinessDay(date: Date, calendar: EcuadorBusinessCalendar): boolean {
  const target = requireValidDate(date);
  const operatingDate = ecuadorOperatingDate(target);
  const [year, month, targetDay] = operatingDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  let businessDays = 0;

  for (let day = 1; day <= targetDay; day += 1) {
    const candidate = isoDate(year, month, day);
    if (!isBusinessDay(candidate, calendar)) continue;
    businessDays += 1;
  }

  return isBusinessDay(operatingDate, calendar) && businessDays === 3;
}

export function businessDaysElapsedInMonth(
  date: Date,
  calendar: EcuadorBusinessCalendar,
): number {
  const target = requireValidDate(date);
  const operatingDate = ecuadorOperatingDate(target);
  const [year, month, targetDay] = operatingDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  let elapsed = 0;
  for (let day = 1; day <= targetDay; day += 1) {
    if (isBusinessDay(isoDate(year, month, day), calendar)) elapsed += 1;
  }
  return elapsed;
}

export function businessDaysBetween(
  from: Date,
  through: Date,
  calendar: EcuadorBusinessCalendar,
): number {
  const start = requireValidDate(from);
  const end = requireValidDate(through);
  // Stryker disable next-line EqualityOperator,ConditionalExpression:
  // @equivalent Same instant/date traverses no candidate days and also yields zero.
  if (end.getTime() <= start.getTime()) return 0;
  let elapsed = 0;
  let candidate = nextIsoDate(ecuadorOperatingDate(start));
  const finalDate = ecuadorOperatingDate(end);
  while (candidate <= finalDate) {
    if (isBusinessDay(candidate, calendar)) elapsed += 1;
    candidate = nextIsoDate(candidate);
  }
  return elapsed;
}

function isBusinessDay(iso: string, calendar: EcuadorBusinessCalendar): boolean {
  const weekday = new Date(`${iso}T00:00:00.000Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !calendar.holidays.has(iso);
}

export function ecuadorOperatingDate(date: Date): string {
  requireValidDate(date);
  return utcDate(new Date(date.getTime() - ECUADOR_OFFSET_MS));
}

export function isEcuadorBusinessDayDeadlineOverdue(
  startedAt: Date,
  evaluatedAt: Date,
  calendar: EcuadorBusinessCalendar,
): boolean {
  requireValidDate(startedAt);
  requireValidDate(evaluatedAt);
  let deadlineDate = ecuadorOperatingDate(startedAt);
  while (!isBusinessDay(deadlineDate, calendar)) {
    deadlineDate = nextIsoDate(deadlineDate);
  }
  return ecuadorOperatingDate(evaluatedAt) > deadlineDate;
}

function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function nextIsoDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return utcDate(date);
}

function requireVendorAccountId(value: string | undefined): string {
  if (!value?.trim()) throw new TypeError("vendorAccountId is required for vendor-scoped jobs");
  return value;
}

function requireValidDate(value: Date): Date {
  if (Number.isNaN(value.getTime())) throw new TypeError("at must be a valid Date");
  return value;
}

function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcHour(date: Date): string {
  return date.toISOString().slice(0, 13);
}

function utcQuarterHour(date: Date): string {
  const minute = Math.floor(date.getUTCMinutes() / 15) * 15;
  return `${utcHour(date)}:${String(minute).padStart(2, "0")}`;
}
