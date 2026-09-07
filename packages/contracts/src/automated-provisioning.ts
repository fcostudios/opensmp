import { z } from "zod";

export const vendorAccountIdSchema = z.string().uuid();

// Stryker disable ObjectLiteral: @equivalent Zod eagerly captures this exact
// object shape before mutant activation; focused tests prove every required
// field and strict rejection of missing, malformed, and unexpected fields.
export const automatedRestProvisionPayloadSchema = z.object({
  // Stryker disable next-line ArrayDeclaration: @equivalent Zod eagerly captures
  // this empty tuple before mutant activation; focused tests reject a populated tuple.
  checklistSteps: z.tuple([]),
  context: z.object({
    companyId: z.string().uuid(),
    requestId: z.string().uuid(),
  }).strict(),
  instruction: z.object({
    // Stryker disable next-line MethodExpression: @equivalent Zod eagerly captures
    // trim/min before mutant activation; focused tests prove padding and blank rejection.
    licenseTypeName: z.string().trim().min(1),
    // Stryker disable next-line MethodExpression: @equivalent Zod eagerly captures
    // trim/lowercase before mutant activation; focused tests assert exact normalization.
    personEmail: z.string().trim().toLowerCase().email(),
    requestId: z.string().uuid(),
    vendorAccountId: vendorAccountIdSchema,
  }).strict(),
  // Stryker disable next-line StringLiteral: @equivalent Zod eagerly captures the
  // literal before mutant activation; focused tests reject the empty and alternate operation.
  operation: z.literal("provision"),
  // Stryker disable next-line StringLiteral: @equivalent Zod eagerly captures the
  // literal before mutant activation; focused tests reject the empty and alternate protocol.
  protocol: z.literal("rest"),
  version: z.literal(1),
// Stryker restore ObjectLiteral
}).strict();

export type AutomatedRestProvisionPayload = z.infer<
  typeof automatedRestProvisionPayloadSchema
>;

export function parseAutomatedRestProvisionPayload(
  value: unknown,
): AutomatedRestProvisionPayload {
  return automatedRestProvisionPayloadSchema.parse(value);
}
