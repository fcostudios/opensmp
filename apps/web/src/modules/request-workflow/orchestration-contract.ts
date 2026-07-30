import { z } from "zod";

export type ChecklistStepMessageKey =
  | "connector.manual.open_vendor_console"
  | "connector.manual.invite_person"
  | "connector.manual.assign_license"
  | "connector.manual.remove_person"
  | "connector.manual.revoke_license"
  | "connector.manual.confirm_execution";

function checklistPayloadSchema() {
  const checklistStepSchema = z.object({
    messageKey: z.enum([
      "connector.manual.open_vendor_console",
      "connector.manual.invite_person",
      "connector.manual.assign_license",
      "connector.manual.remove_person",
      "connector.manual.revoke_license",
      "connector.manual.confirm_execution",
    ]),
    params: z.object({
      personEmail: z.string().email(),
      licenseTypeName: z.string().trim().min(1),
    }).strict(),
    targets: z.object({
      requestId: z.string().uuid(),
      vendorAccountId: z.string().uuid(),
      personId: z.string().uuid(),
      licenseId: z.string().uuid(),
    }).strict(),
  }).strict();
  return z.object({
    checklistSteps: z.array(checklistStepSchema).min(1),
    context: z.unknown(),
    instruction: z.object({
      requestId: z.string().uuid(),
      vendorAccountId: z.string().uuid(),
      personEmail: z.string().email(),
      licenseTypeName: z.string().trim().min(1),
    }).strict(),
    operation: z.enum(["provision", "deprovision"]),
    protocol: z.enum(["none", "rest", "scim"]),
    version: z.literal(1),
  }).strict();
}

export function parseChecklistPayload(rawRequest: unknown) {
  return checklistPayloadSchema().parse(rawRequest);
}

export function safeParseChecklistPayload(rawRequest: unknown) {
  return checklistPayloadSchema().safeParse(rawRequest);
}

export function parseConfirmChecklist(input: unknown) {
  return z.object({
    actionId: z.string().uuid(),
    confirmationId: z.string().trim().min(1).max(200),
  }).strict().parse(input);
}

export function safeParseConfirmChecklist(input: unknown) {
  try {
    return { success: true as const, data: parseConfirmChecklist(input) };
  } catch {
    return { success: false as const };
  }
}

export function parseFailChecklist(input: unknown) {
  return z.object({
    actionId: z.string().uuid(),
    failureId: z.string().trim().min(1).max(200),
    reason: z.string(),
  }).strict().parse(input);
}

export function safeParseFailChecklist(input: unknown) {
  try {
    return { success: true as const, data: parseFailChecklist(input) };
  } catch {
    return { success: false as const };
  }
}

export function parseObservation(input: unknown) {
  return z.object({
    actionId: z.string().uuid(),
    observedAssigned: z.boolean(),
    observedAt: z.date(),
    observationId: z.string().trim().min(1).max(200),
    source: z.literal("member_sync"),
  }).strict().parse(input);
}

export function safeParseObservation(input: unknown) {
  try {
    return { success: true as const, data: parseObservation(input) };
  } catch {
    return { success: false as const };
  }
}

export function validatedChecklistSteps(rawRequest: unknown) {
  return parseChecklistPayload(rawRequest).checklistSteps;
}
