"use server";

import { ackAlertPolicy, type AckAlertResult } from "./ack-alert-policy";
import { createAlertRepository } from "./repository";
import { loadCurrentLedgerAuthorization } from "../identity-access/server-authorization";

/**
 * @read-only-action This wrapper validates authorization and dispatches to
 * `repository.acknowledgeEvent`, which commits the conditional UPDATE and
 * its single audit_log row in the same Postgres transaction (first-writer-
 * wins; see repository.ts). No separate audited mutation happens here.
 */
export async function ackAlert(input: unknown): Promise<AckAlertResult> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const authorization = await loadCurrentLedgerAuthorization();
  const repository = createAlertRepository(process.env.DATABASE_URL);
  try {
    return await ackAlertPolicy(
      {
        authorization,
        acknowledge: repository.acknowledgeEvent,
        now: () => new Date(),
      },
      input,
    );
  } finally {
    await repository.close();
  }
}
