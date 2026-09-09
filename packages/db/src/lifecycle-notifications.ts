import { sql } from "drizzle-orm";
import type { RequestTransitionTransaction } from "./request-transition.js";

type LedgerTransaction = RequestTransitionTransaction;
type DecisionState = "approved" | "rejected";

export async function enqueueLifecycleDecision(
  transaction: LedgerTransaction,
  requestId: string,
  state: DecisionState,
  occurredAt: Date,
): Promise<void> {
  await enqueueRequesterNotification(
    transaction,
    requestId,
    "decision",
    state,
    occurredAt,
  );
}

export async function enqueueLifecycleProvisioningComplete(
  transaction: LedgerTransaction,
  requestId: string,
  occurredAt: Date,
): Promise<void> {
  await enqueueRequesterNotification(
    transaction,
    requestId,
    "provisioning_complete",
    "active",
    occurredAt,
  );
}

async function enqueueRequesterNotification(
  transaction: LedgerTransaction,
  requestId: string,
  kind: "decision" | "provisioning_complete",
  state: DecisionState | "active",
  occurredAt: Date,
): Promise<void> {
  await transaction.execute(
    sql`INSERT INTO lifecycle_notification
          (request_id, company_id, kind, recipient_user_account_id,
           recipient_email, recipient_locale, request_state, dedupe_key,
           created_at)
        SELECT request.id, request.company_id,
               ${kind}::lifecycle_notification_kind_enum,
               requester.id, requester.email, requester.ui_language,
               ${state}::license_request_state_enum,
               request.id::text || ':' || ${kind} || ':' || ${state} || ':' ||
                 lower(requester.email),
               ${occurredAt}
        FROM license_request request
        JOIN user_account requester
          ON requester.id = request.requested_by
         AND requester.status = 'active'
        WHERE request.id = ${requestId}::uuid
          AND request.state = ${state}::license_request_state_enum
          AND request.company_id = (
            SELECT person.company_id
            FROM person
            WHERE person.id = request.person_id
          )
        ON CONFLICT (dedupe_key) DO NOTHING`,
  );
}
