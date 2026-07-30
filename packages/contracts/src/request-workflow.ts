import { z } from "zod";

const requestIdSchema = z.string().uuid();

export function createDecideRequestSchema() {
  return z.discriminatedUnion("decision", [
    z
      .object({
        requestId: requestIdSchema,
        decision: z.literal("approved"),
        decisionComment: z.string().trim().min(1).optional(),
      })
      .strict(),
    z
      .object({
        requestId: requestIdSchema,
        decision: z.literal("rejected"),
        decisionComment: z.string().trim().min(1),
      })
      .strict(),
  ]);
}

export const decideRequestSchema = createDecideRequestSchema();

export type DecideRequestInput = z.infer<typeof decideRequestSchema>;
