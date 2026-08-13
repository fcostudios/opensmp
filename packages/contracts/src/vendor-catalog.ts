import { z } from "zod";

const uuidSchema = z.string().uuid();
const isoDateFormat = /^\d{4}-\d{2}-\d{2}$/;

const optionalTrimmedTextSchema = z
  .preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().max(200).nullable(),
  )
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
      }, "Invalid calendar date")
      .nullable(),
  )
  .transform((value) => value ?? null);

export const vendorAccountModeSchema = z.enum(["automated", "orchestration"]);
export const vendorAccountStatusSchema = z.enum(["active", "inactive"]);

export const createVendorAccountSchema = z
  .object({
    vendorId: uuidSchema,
    name: z.string().trim().min(1).max(200),
    mode: vendorAccountModeSchema,
    vendorOrgRef: optionalTrimmedTextSchema,
    contractRenewalOn: nullableIsoDateSchema,
    lowPoolFloor: z.number().int().nonnegative().max(2_147_483_647).safe(),
  })
  .strict();

export const updateVendorAccountSchema = createVendorAccountSchema
  .omit({ vendorId: true })
  .extend({
    id: uuidSchema,
    status: vendorAccountStatusSchema,
  })
  .strict();

export type VendorAccountMode = z.infer<typeof vendorAccountModeSchema>;
export type VendorAccountStatus = z.infer<typeof vendorAccountStatusSchema>;
export type CreateVendorAccountInput = z.infer<typeof createVendorAccountSchema>;
export type UpdateVendorAccountInput = z.infer<typeof updateVendorAccountSchema>;
