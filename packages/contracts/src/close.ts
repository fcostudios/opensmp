import { z } from "zod";
export const runCloseSchema = z.object({
  period: z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/),
  note: z.string().trim().max(2000).nullable().default(null),
}).strict();
export type CloseActionState = { status: "idle" | "error" } | { status: "succeeded" | "failed"; runId: string; durationMs: number };

// Confirmation is a command precondition, never inferred from a previous action state.
export const finalizeStatementsSchema = z.object({
  period: runCloseSchema.shape.period,
  confirmed: z.literal(true),
}).strict();
export const finalizeStatementSchema = finalizeStatementsSchema.extend({ statementId: z.string().uuid() });
export type FinalizeActionState = { status: "idle" | "error" } | { status: "finalized"; count: number };
