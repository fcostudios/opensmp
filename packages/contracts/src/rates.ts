import { z } from "zod";

// @equivalent: removing either regex anchor cannot admit extra text because the ISO round-trip must equal the entire input.
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid calendar date"); // @equivalent: actions expose a generic localized failure, so changing only this internal diagnostic preserves behavior.

export const saveRateCardSchema = z.object({
  id: z.string().uuid().optional(),
  vendorAccountId: z.string().uuid(),
  licenseTypeId: z.string().uuid(),
  monthlyRateUsd: z.string().regex(/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/),
  effectiveFrom: date,
  effectiveTo: date.nullable().default(null),
  provisional: z.boolean().default(true),
}).strict().refine(value => value.effectiveTo === null || value.effectiveTo >= value.effectiveFrom, {
  path: ["effectiveTo"], message: "End date precedes start date", // @equivalent: changing only the internal message preserves rejection and the tested field path; actions localize a generic failure.
});

export type SaveRateCardInput = z.infer<typeof saveRateCardSchema>;
