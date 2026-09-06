import type { LedgerAuthorization } from "../identity-access/authorization";
import { ackAlertPolicy, type AckAlertResult } from "./ack-alert-policy";
import { createAlertRepository } from "./repository";

type AckAlertActionDependencies = Readonly<{
  databaseUrl: () => string | undefined;
  loadAuthorization: () => Promise<LedgerAuthorization | null>;
  now?: () => Date;
}>;

export function createAckAlertAction(dependencies: AckAlertActionDependencies) {
  return async (input: unknown): Promise<AckAlertResult> => {
    const databaseUrl = dependencies.databaseUrl();
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    const authorization = await dependencies.loadAuthorization();
    if (!authorization) return { ok: false, error: "forbidden" };
    return ackAlertWithAuthorization(input, {
      authorization,
      databaseUrl,
      now: dependencies.now,
    });
  };
}

export async function ackAlertWithAuthorization(
  input: unknown,
  context: Readonly<{
    authorization: LedgerAuthorization;
    databaseUrl: string;
    now?: () => Date;
  }>,
): Promise<AckAlertResult> {
  if (!context.databaseUrl) throw new Error("DATABASE_URL is required");
  if (!context.authorization) throw new Error("authorization is required");
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
