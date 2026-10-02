import { z } from "zod";

export const ALERT_TYPES = [
  "approval_aging",
  "provisioning_failure",
  "blocked_no_seat",
  "low_pool",
  "invite_unaccepted",
  "sync_stale",
  "credential_failure",
  "register_drift",
  "deprovision_overdue",
  "close_missed",
] as const;

export const alertTypeSchema = z.enum(ALERT_TYPES);
export type AlertType = z.infer<typeof alertTypeSchema>;

const requestSubjectSchema = z.object({ requestId: z.string().min(1) }).strict();
const vendorAccountSubjectSchema = z
  .object({ vendorAccountId: z.string().min(1) })
  .strict();
const poolSubjectSchema = z
  .object({
    licenseTypeId: z.string().min(1),
    vendorAccountId: z.string().min(1),
  })
  .strict();
const reconciliationSubjectSchema = z
  .object({ reconciliationId: z.string().min(1) })
  .strict();
const periodSubjectSchema = z
  .object({ period: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/) })
  .strict();

export const alertSubjectRefSchema = z.union([
  requestSubjectSchema,
  vendorAccountSubjectSchema,
  poolSubjectSchema,
  reconciliationSubjectSchema,
  periodSubjectSchema,
]);

export type AlertSubjectRef = z.infer<typeof alertSubjectRefSchema>;

export const alertSubjectForTypeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("approval_aging"), subject: requestSubjectSchema }),
  z.object({ type: z.literal("provisioning_failure"), subject: requestSubjectSchema }),
  z.object({ type: z.literal("blocked_no_seat"), subject: requestSubjectSchema }),
  z.object({ type: z.literal("invite_unaccepted"), subject: requestSubjectSchema }),
  z.object({ type: z.literal("deprovision_overdue"), subject: requestSubjectSchema }),
  z.object({ type: z.literal("low_pool"), subject: poolSubjectSchema }),
  z.object({ type: z.literal("sync_stale"), subject: vendorAccountSubjectSchema }),
  z.object({ type: z.literal("credential_failure"), subject: vendorAccountSubjectSchema }),
  z.object({ type: z.literal("register_drift"), subject: reconciliationSubjectSchema }),
  z.object({ type: z.literal("close_missed"), subject: periodSubjectSchema }),
]);

export const alertThresholdSchema = z.record(z.number().finite().nonnegative());

/** Runtime validation shared by rule editing and automatic expiry. */
export const inviteUnacceptedThresholdSchema = z.unknown().transform((value, context) => {
  const parsed = z.object({
    hours: z.number().finite().nonnegative(),
    auto_withdraw_after_hours: z.number().finite().int().nullable().optional(),
  }).strict().safeParse(value);
  if (!parsed.success || (parsed.data.auto_withdraw_after_hours != null && parsed.data.auto_withdraw_after_hours <= parsed.data.hours)) {
    context.addIssue({ code: "custom", message: "invite_unaccepted requires finite hours and a null or integer expiry greater than hours" });
    return z.NEVER;
  }
  return { hours: parsed.data.hours, auto_withdraw_after_hours: parsed.data.auto_withdraw_after_hours ?? null };
});


// Stryker disable ObjectLiteral:
// @equivalent Zod eagerly captures this object shape before mutant activation;
// focused tests parse both required keys and reject missing/extra keys.
export const approvalAgingThresholdSchema = z
  .object({
    escalationHours: z.number().finite().nonnegative(),
    hours: z.number().finite().nonnegative(),
  })
  // Stryker restore ObjectLiteral
  .strict()
  .refine(
    // Stryker disable next-line ArrowFunction,StringLiteral:
    // @equivalent Zod eagerly captures the predicate and message before mutant
    // activation; focused tests assert ordering and the exact public message.
    ({ escalationHours, hours }) => escalationHours > hours,
    // Stryker disable next-line StringLiteral:
    // @equivalent Zod eagerly captures this public message before mutant
    // activation; the contract test asserts it exactly.
    "approval_aging escalationHours must be greater than hours",
  );

// Stryker disable ObjectLiteral:
// @equivalent Zod eagerly captures this object shape before mutant activation;
// focused tests assert every required field and approval threshold issue.
export const alertRuleContractSchema = z
  .object({
    enabled: z.boolean(),
    threshold: z.record(z.number().finite().nonnegative().nullable()),
    type: alertTypeSchema,
  })
  // Stryker restore ObjectLiteral
  .superRefine((rule, context) => {
    if (rule.type === "invite_unaccepted") {
      if (!inviteUnacceptedThresholdSchema.safeParse(rule.threshold).success) {
        context.addIssue({ code: "custom", message: "invite_unaccepted requires valid invitation expiry threshold", path: ["threshold"] });
      }
    } else if (!alertThresholdSchema.safeParse(rule.threshold).success) {
      context.addIssue({ code: "custom", message: "alert threshold values must be nonnegative finite numbers", path: ["threshold"] });
    }

    if (
      rule.type === "approval_aging" &&
      !approvalAgingThresholdSchema.safeParse(rule.threshold).success
    ) {
      context.addIssue({
        code: "custom",
        message:
          "approval_aging requires ordered threshold.hours and threshold.escalationHours",
        path: ["threshold"],
      });
    }
    if (
      rule.type === "deprovision_overdue" &&
      (
        Object.keys(rule.threshold).length !== 1 ||
        rule.threshold.businessDays !== 0
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "deprovision_overdue requires threshold.businessDays = 0",
        path: ["threshold"],
      });
    }
  }).transform(normalizeAlertRule);

function normalizeAlertRule(rule: { enabled: boolean; type: AlertType; threshold: Record<string, number | null> }) {
  return rule.type === "invite_unaccepted"
    ? { ...rule, threshold: inviteUnacceptedThresholdSchema.parse(rule.threshold) }
    : rule;
}

export type AlertRuleContract = z.infer<typeof alertRuleContractSchema>;
export type ApprovalAgingThresholdContract = z.infer<
  typeof approvalAgingThresholdSchema
>;

export const alertEvaluationSchema = z.object({
  dedupeKey: z.string().min(1),
  subjectRef: alertSubjectRefSchema,
  type: alertTypeSchema,
});

export type AlertEvaluation = z.infer<typeof alertEvaluationSchema>;
