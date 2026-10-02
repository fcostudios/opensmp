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


/** Expiry has a distinct identity from approval decisions and uses the completion transaction. */
export async function enqueueLifecycleInvitationExpired(
  transaction: LedgerTransaction,
  companyId: string,
  requestId: string,
  originalInvitationActionId: string,
  occurredAt: Date,
): Promise<void> {
  const result = await transaction.execute<{ enqueued: boolean }>(sql`WITH recipient AS (
    SELECT request.id AS request_id,request.company_id,requester.id AS requester_id,
      requester.email,requester.ui_language,
      request.company_id::text || ':' || request.id::text || ':invitation-expired:' || original.id::text || ':' || requester.id::text AS dedupe_key
    FROM license_request request
    JOIN person ON person.id=request.person_id AND person.company_id=request.company_id
    JOIN user_account requester ON requester.id=request.requested_by AND requester.status='active'
      AND requester.email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    JOIN provisioning_action original ON original.request_id=request.id AND original.vendor_account_id=request.vendor_account_id
      AND original.id=${originalInvitationActionId}::uuid AND original.kind='invite' AND original.mode='automated' AND original.status='withdrawn'
    WHERE request.id=${requestId}::uuid AND request.company_id=${companyId}::uuid AND request.state='deprovisioned'
  ), inserted AS (
    INSERT INTO lifecycle_notification
      (request_id,company_id,kind,recipient_user_account_id,recipient_email,recipient_locale,request_state,dedupe_key,created_at)
    SELECT request_id,company_id,'decision',requester_id,email,ui_language,'deprovisioned',dedupe_key,${occurredAt}
    FROM recipient ON CONFLICT(dedupe_key) DO NOTHING RETURNING id
  ) SELECT EXISTS (
    SELECT 1 FROM inserted
    UNION ALL
    SELECT 1 FROM lifecycle_notification notification JOIN recipient
      ON notification.dedupe_key=recipient.dedupe_key
      AND notification.request_id=recipient.request_id AND notification.company_id=recipient.company_id
      AND notification.recipient_user_account_id=recipient.requester_id
      AND notification.kind='decision' AND notification.request_state='deprovisioned'
  ) AS enqueued`);
  if (result.rows[0]?.enqueued !== true) throw new Error("INVITATION_EXPIRY_NOTIFICATION_MISSING");
}
