import { z } from "zod";

export const personInputSchema = z.object({
  id: z.string().uuid().optional(),
  fullName: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email(),
  companyId: z.string().uuid(),
  status: z.enum(["active", "departed"]),
  confirmCompanyMove: z.boolean().default(false),
});

export type PersonInput = z.infer<typeof personInputSchema>;

export const startOffboardingInputSchema = z.object({
  personId: z.string().uuid(),
  endReason: z.enum(["left_company", "inactive", "reallocated"]),
  note: z.string().trim().min(1).max(1_000),
});

export type StartOffboardingInput = z.infer<
  typeof startOffboardingInputSchema
>;
