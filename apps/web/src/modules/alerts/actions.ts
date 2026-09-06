"use server";

import { createAckAlertAction } from "./ack-alert-service";
import { loadCurrentLedgerAuthorization } from "../identity-access/server-authorization";

/**
 * @read-only-action This wrapper validates authorization and dispatches to
 * `ackAlertWithAuthorization`, whose real repository transaction commits the
 * conditional UPDATE and its single audit_log row (first-writer-wins; see
 * repository.ts). No separate audited mutation happens here.
 */
export const ackAlert = createAckAlertAction({
  databaseUrl: () => process.env.DATABASE_URL,
  loadAuthorization: loadCurrentLedgerAuthorization,
  now: () => new Date(),
});
