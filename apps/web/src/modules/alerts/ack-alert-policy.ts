import { ackAlertSchema } from "@smp/contracts";

import type { LedgerAuthorization } from "../identity-access/authorization";
import type { AlertRepository } from "./repository";

export type AckAlertResult =
  | { readonly ok: true; readonly acknowledgedBy: string; readonly acknowledgedAt: string }
  | { readonly ok: false; readonly error: "forbidden" | "invalid" | "not_found" };

export async function ackAlertPolicy(
  dependencies: {
    readonly authorization: LedgerAuthorization | null;
    readonly acknowledge: AlertRepository["acknowledgeEvent"];
    readonly now: () => Date;
  },
  input: unknown,
): Promise<AckAlertResult> {
  const { authorization } = dependencies;
  if (!authorization || authorization.globalRole !== "group_admin") {
    return { ok: false, error: "forbidden" };
  }
  const parsed = ackAlertSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const result = await dependencies.acknowledge({
    alertEventId: parsed.data.alertEventId,
    actorUserAccountId: authorization.userAccountId,
    authorization,
    occurredAt: dependencies.now(),
  });
  if (result.status === "not_found") return { ok: false, error: "not_found" };
  return {
    ok: true,
    acknowledgedBy: result.acknowledgedBy,
    acknowledgedAt: result.acknowledgedAt.toISOString(),
  };
}
