import { z } from "zod";

export const ackAlertSchema = z
  .object({
    alertEventId: z.string().uuid(),
  })
  .strict();

export type AckAlertInput = z.infer<typeof ackAlertSchema>;
