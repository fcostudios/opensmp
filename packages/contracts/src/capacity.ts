import { z } from "zod";

const uuidSchema = z.string().uuid();
const isoDateFormat = /^\d{4}-\d{2}-\d{2}$/;
const isoDateSchema = z
  .string()
  .regex(isoDateFormat)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Invalid calendar date");

export const capacityChangeSchema = z
  .object({
    effectiveFrom: isoDateSchema,
    licenseTypeId: uuidSchema,
    note: z.string().trim().min(1).max(1_000).optional(),
    purchasedQty: z.number().int().nonnegative(),
    reason: z.enum(["purchase", "correction"]),
    vendorAccountId: uuidSchema,
  })
  .strict();

export const capacityRecoveryJobSchema = z
  .object({
    capacityId: uuidSchema,
    effectiveFrom: isoDateSchema,
    licenseTypeId: uuidSchema,
    publishedAt: z.string().datetime({ offset: true }),
    vendorAccountId: uuidSchema,
  })
  .strict();

const inactiveCandidateSchema = z
  .object({
    assignmentId: uuidSchema,
    lastActiveOn: isoDateSchema,
    monthlyCostUsd: z.number().positive(),
  })
  .strict();

export const capacityDecisionEvidenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("no_data") }).strict(),
  z
    .object({
      items: z.array(inactiveCandidateSchema).min(1),
      type: z.literal("candidates"),
    })
    .strict(),
]);

export type CapacityChangeInput = z.infer<typeof capacityChangeSchema>;
export type CapacityRecoveryJob = z.infer<typeof capacityRecoveryJobSchema>;
export type CapacityDecisionEvidence = z.infer<
  typeof capacityDecisionEvidenceSchema
>;
