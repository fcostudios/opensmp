"use server";

import type { AckAlertResult } from "./ack-alert-policy";
import { ackAlertWithAuthorization } from "./ack-alert-service";
import { loadCurrentLedgerAuthorization } from "../identity-access/server-authorization";

/**
 * @read-only-action This wrapper validates authorization and dispatches to
 * `ackAlertWithAuthorization`, whose real repository transaction commits the
 * conditional UPDATE and its single audit_log row (first-writer-wins; see
 * repository.ts). No separate audited mutation happens here.
 */
export async function ackAlert(input: unknown): Promise<AckAlertResult> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const authorization = await loadCurrentLedgerAuthorization();
  if (!authorization) return { ok: false, error: "forbidden" };
  return ackAlertWithAuthorization(input, {
    authorization,
    databaseUrl: process.env.DATABASE_URL,
  });
}
