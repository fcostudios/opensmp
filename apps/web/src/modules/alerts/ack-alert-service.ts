import type { LedgerAuthorization } from "../identity-access/authorization";
import { ackAlertPolicy, type AckAlertResult } from "./ack-alert-policy";
import { createAlertRepository } from "./repository";

export async function ackAlertWithAuthorization(
  input: unknown,
  context: Readonly<{
    authorization: LedgerAuthorization;
    databaseUrl: string;
    now?: () => Date;
  }>,
): Promise<AckAlertResult> {
  if (!context.databaseUrl) throw new Error("DATABASE_URL is required");
  const repository = createAlertRepository(context.databaseUrl);
  try {
    return await ackAlertPolicy(
      {
        authorization: context.authorization,
        acknowledge: repository.acknowledgeEvent,
        now: context.now ?? (() => new Date()),
      },
      input,
    );
  } finally {
    await repository.close();
  }
}
