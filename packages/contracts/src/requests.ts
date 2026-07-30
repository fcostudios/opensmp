import { z } from "zod";

export function createSubmitRequestSchema() {
  const uuid = z.string().uuid();
  const isoDate = z.string().refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  });
  const commonFields = {
    clientRequestId: uuid,
    vendorAccountId: uuid,
    licenseTypeId: uuid,
    justification: z.string().trim().min(1).max(2_000),
    neededBy: isoDate.optional(),
  };
  return z.discriminatedUnion("requestFor", [
    z
      .object({
        ...commonFields,
        requestFor: z.literal("self"),
      })
      .strict(),
    z
      .object({
        ...commonFields,
        requestFor: z.literal("on_behalf"),
        personEmail: z.string().trim().email().transform((value) => value.toLowerCase()),
        personFullName: z.string().trim().min(1).max(200),
        personCompanyId: uuid,
      })
      .strict(),
  ]);
}

export const submitRequestSchema = createSubmitRequestSchema();

export type SubmitRequestInput = z.infer<typeof submitRequestSchema>;
