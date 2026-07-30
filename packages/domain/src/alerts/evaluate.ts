import { alertSubjectForTypeSchema } from "@smp/contracts/alerts";

import type {
  AlertEvaluation,
  AlertFacts,
  AlertRuleContract,
  AlertSubjectRef,
  AlertType,
} from "./types.js";

const thresholdMeasures = {
  approval_aging: ["hours", "ageHours"],
  blocked_no_seat: ["businessDays", "businessDaysElapsed"],
  close_missed: ["businessDays", "businessDaysElapsed"],
  credential_failure: ["failures", "failed"],
  deprovision_overdue: ["businessDays", "deadlineExceeded"],
  invite_unaccepted: ["hours", "ageHours"],
  low_pool: ["floor", "free"],
  provisioning_failure: ["failures", "failed"],
  register_drift: ["mismatches", "drifted"],
  sync_stale: ["hours", "ageHours"],
} as const satisfies Record<AlertType, readonly [string, keyof AlertFacts]>;

export function alertSubjectDestination(
  type: AlertType,
  subject: AlertSubjectRef,
): string {
  const parsed = alertSubjectForTypeSchema.parse({ subject, type });
  switch (parsed.type) {
    case "approval_aging":
    case "provisioning_failure":
    case "blocked_no_seat":
    case "invite_unaccepted":
    case "deprovision_overdue":
      return `/solicitudes/${encodeURIComponent(parsed.subject.requestId)}`;
    case "low_pool":
      return `/cupos?vendorAccountId=${encodeURIComponent(parsed.subject.vendorAccountId)}&licenseTypeId=${encodeURIComponent(parsed.subject.licenseTypeId)}`;
    case "sync_stale":
    case "credential_failure":
      return "/credenciales";
    case "register_drift":
      return "/excepciones";
    case "close_missed":
      return `/cierre?period=${encodeURIComponent(parsed.subject.period)}`;
    // Stryker disable all: AlertType is closed and every member is handled above.
    default: {
      const exhaustive: never = parsed;
      throw new TypeError(`unsupported alert destination: ${String(exhaustive)}`);
    }
    // Stryker restore all
  }
}

export function evaluateAlertRule(
  rule: AlertRuleContract,
  facts: AlertFacts,
  evaluatedAt: Date,
): AlertEvaluation | null {
  if (!Number.isFinite(evaluatedAt.getTime())) {
    throw new TypeError("evaluatedAt must be a valid date");
  }
  const parsedSubject = alertSubjectForTypeSchema.safeParse({
    subject: facts.subject,
    type: rule.type,
  });
  if (!parsedSubject.success) {
    throw new TypeError(`subject does not match alert type ${rule.type}`);
  }
  const subjectRef = parsedSubject.data.subject;
  if (!rule.enabled) return null;

  const [thresholdName, factName] = thresholdMeasures[rule.type];
  const threshold =
    rule.type === "low_pool" && facts.lowPoolFloor !== undefined
      ? facts.lowPoolFloor
      : rule.threshold[thresholdName];
  const measure = facts[factName];
  if (!Number.isFinite(threshold)) {
    throw new TypeError(
      rule.type === "low_pool" && facts.lowPoolFloor !== undefined
        ? "low_pool lowPoolFloor must be finite"
        : `${rule.type} threshold.${thresholdName} must be finite`,
    );
  }
  if (!isBreached(rule.type, measure, threshold)) return null;

  const subjectIdentity = Object.entries(subjectRef)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value)
    .join(":");
  return {
    dedupeKey: `${rule.type}:${subjectIdentity}:${evaluatedAt.toISOString()}`,
    subjectRef,
    type: rule.type,
  };
}

function isBreached(
  type: AlertType,
  measure: AlertFacts[keyof AlertFacts],
  threshold: number,
): boolean {
  switch (type) {
    case "low_pool":
      return Number.isFinite(measure as number) && (measure as number) < threshold;
    case "approval_aging":
    case "blocked_no_seat":
    case "invite_unaccepted":
    case "sync_stale":
    case "close_missed":
      return Number.isFinite(measure as number) && (measure as number) > threshold;
    // Stryker disable next-line ConditionalExpression:
    // @equivalent canonical contracts admit only threshold zero, so falling
    // through to the boolean <= 1 branch has identical reachable behavior.
    case "deprovision_overdue":
      return measure === true && threshold === 0;
    case "credential_failure":
    case "provisioning_failure":
    case "register_drift":
      return measure === true && threshold <= 1;
    // Stryker disable all: @equivalent: AlertType is a closed union and every member is handled above.
    default: {
      const exhaustive: never = type;
      throw new TypeError(`unsupported alert type: ${exhaustive}`);
    }
    // Stryker restore all
  }
}
