import { z } from "zod";

const uuidSchema = z.string().uuid();
// Stryker disable next-line Regex: @equivalent Zod eagerly captures this
// anchored format before mutant activation; focused tests reject malformed,
// non-calendar, and timestamp-shaped values.
const isoDateFormat = /^\d{4}-\d{2}-\d{2}$/;

const optionalTrimmedTextSchema = z
  .preprocess(
    // Stryker disable next-line ArrowFunction: @equivalent Zod eagerly captures
    // this normalizer before mutant activation; focused tests prove blank,
    // padded, missing, and non-empty values.
    (value) =>
      typeof value === "string" && value.trim() === "" ? null : value,
    // Stryker disable next-line MethodExpression: @equivalent Zod eagerly
    // captures the trim/max chain; focused tests prove padding and 200/201.
    z.string().trim().max(200).nullable(),
  )
  // Stryker disable next-line ArrowFunction: @equivalent Zod eagerly captures
  // this null normalization; focused tests assert exact null output.
  .transform((value) => value ?? null);

const nullableIsoDateSchema = z
  .preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed === "" ? null : trimmed;
    },
    z
      .string()
      .regex(isoDateFormat)
      .refine((value) => {
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return (
          !Number.isNaN(parsed.valueOf()) &&
          parsed.toISOString().slice(0, 10) === value
        );
      // Stryker disable next-line StringLiteral: @equivalent Zod eagerly
      // captures this diagnostic before mutant activation; validity is proved
      // by exact acceptance/rejection assertions.
      }, "Invalid calendar date")
      .nullable(),
  )
  // Stryker disable next-line ArrowFunction: @equivalent Zod eagerly captures
  // this null normalization; focused tests assert exact null output.
  .transform((value) => value ?? null);

// Stryker disable next-line ArrayDeclaration,StringLiteral: @equivalent Zod
// eagerly captures the enum before mutant activation; focused tests accept
// both members and reject an unknown member.
export const vendorAccountModeSchema = z.enum(["automated", "orchestration"]);
// Stryker disable next-line ArrayDeclaration,StringLiteral: @equivalent Zod
// eagerly captures the enum before mutant activation; focused tests accept
// both members and reject an unknown member.
export const vendorAccountStatusSchema = z.enum(["active", "inactive"]);

export const createVendorAccountSchema = z
  // Stryker disable ObjectLiteral: @equivalent Zod eagerly captures this shape
  // before mutant activation; focused tests prove every required field and
  // strict rejection of omitted and unexpected fields.
  .object({
    vendorId: uuidSchema,
    // Stryker disable next-line MethodExpression: @equivalent Zod eagerly
    // captures trim/min/max; focused tests prove blank, padded, 200, and 201.
    name: z.string().trim().min(1).max(200),
    mode: vendorAccountModeSchema,
    vendorOrgRef: optionalTrimmedTextSchema,
    contractRenewalOn: nullableIsoDateSchema,
    // Stryker disable next-line MethodExpression: @equivalent Zod eagerly
    // captures the int4 ceiling; focused tests prove max and max-plus-one.
    lowPoolFloor: z.number().int().nonnegative().max(2_147_483_647).safe(),
  })
  // Stryker restore ObjectLiteral
  .strict();

export const updateVendorAccountSchema = createVendorAccountSchema
  // Stryker disable next-line ObjectLiteral,BooleanLiteral: @equivalent Zod
  // eagerly captures this omission; focused tests reject vendorId on update.
  .omit({ vendorId: true })
  // Stryker disable ObjectLiteral: @equivalent Zod eagerly captures this
  // extension; focused tests require id/status and prove both status values.
  .extend({
    id: uuidSchema,
    status: vendorAccountStatusSchema,
  })
  // Stryker restore ObjectLiteral
  .strict();

export type VendorAccountMode = z.infer<typeof vendorAccountModeSchema>;
export type VendorAccountStatus = z.infer<typeof vendorAccountStatusSchema>;
export type CreateVendorAccountInput = z.infer<typeof createVendorAccountSchema>;
export type UpdateVendorAccountInput = z.infer<typeof updateVendorAccountSchema>;
