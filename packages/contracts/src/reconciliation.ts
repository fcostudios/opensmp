import { z } from "zod";
import { runCloseSchema } from "./close";
export const reconciliationKey = z.object({ period: runCloseSchema.shape.period, vendorAccountId: z.string().uuid() }).strict();
export const money = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/);
export const saveInvoiceSchema = reconciliationKey.extend({ invoiceAmountUsd: money });
export const overrideReconciliationSchema = reconciliationKey.extend({ note: z.string().trim().min(1).max(2000) });
export const varianceCauses = ["mid_cycle_proration", "invite_consumed", "timing", "rate_mismatch", "other"] as const;
export const saveVarianceSchema = reconciliationKey.extend({
  lineId: z.string().uuid().optional(), cause: z.enum(varianceCauses), detail: z.string().trim().min(1).max(2000),
  registerAmountUsd: money, invoiceAmountUsd: money,
  evidenceUrl: z.string().url().max(2000).refine(value => /^https?:\/\//i.test(value)).nullable(),
});
export const deleteVarianceSchema = reconciliationKey.extend({ lineId: z.string().uuid() });
export type ReconciliationState = { status: "idle" | "saved" | "reconciled" | "overridden" | "error" };
export type ReconciliationAction = (state: ReconciliationState, form: FormData) => Promise<ReconciliationState>;
