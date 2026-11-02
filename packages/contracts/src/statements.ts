import { z } from "zod";
import { runCloseSchema } from "./close";

/** Read contract shared by SCR-statements and SCR-close. No client scope claims. */
export const statementFiltersSchema = z.object({
  period: runCloseSchema.shape.period,
  companyId: z.string().uuid().optional(),
  status: z.enum(["draft", "final", "reconciled"]).optional(),
}).strict();

export type StatementFilters = z.infer<typeof statementFiltersSchema>;
