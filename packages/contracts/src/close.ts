import { z } from "zod";
export const runCloseSchema = z.object({
  period: z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/),
  note: z.string().trim().max(2000).nullable().default(null),
}).strict();
export type CloseActionState = { status: "idle" | "error" } | { status: "succeeded" | "failed"; runId: string; durationMs: number };
