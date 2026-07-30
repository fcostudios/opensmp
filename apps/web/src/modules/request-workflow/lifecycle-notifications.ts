import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type pg from "pg";

// eslint-disable-next-line no-restricted-imports -- This module owns the tenant-scoped lifecycle outbox transaction service.
import * as schema from "@smp/db/schema";
import type { LifecycleNotificationKind } from "@smp/notifications/catalog";
import {
  createLifecycleNotificationDispatcher as createSharedLifecycleDispatcher,
  deliveryErrorCode,
} from "@smp/notifications/lifecycle-dispatcher";
import type { NotificationMailer } from "@smp/notifications/mailer";

type Database = NodePgDatabase<typeof schema>;
type LedgerTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
type DecisionState = "approved" | "rejected";

export async function enqueueLifecyclePendingApproval(
  transaction: LedgerTransaction,
  requestId: string,
  occurredAt: Date,
): Promise<void> {
  await transaction.execute(
    sql`INSERT INTO lifecycle_notification
          (request_id, company_id, kind, recipient_user_account_id,
           recipient_email, recipient_locale, request_state, dedupe_key,
           created_at)
        SELECT request.id, request.company_id, recipient.kind,
               recipient.user_account_id, recipient.email,
               recipient.ui_language, 'pending_approval',
               request.id::text || ':' || recipient.kind || ':' ||
                 lower(recipient.email),
               ${occurredAt}
        FROM license_request request
        JOIN LATERAL (
          SELECT 'submission'::lifecycle_notification_kind_enum AS kind,
                 requester.id AS user_account_id, requester.email,
                 requester.ui_language
          FROM user_account requester
          WHERE requester.id = request.requested_by
            AND requester.status = 'active'
          UNION ALL
          SELECT 'new_request_to_approver'::lifecycle_notification_kind_enum,
                 approver.id, approver.email, approver.ui_language
          FROM user_account approver
          WHERE approver.status = 'active'
            AND (
              approver.global_role = 'group_admin'
              OR EXISTS (
                SELECT 1
                FROM company_role_assignment grant_row
                WHERE grant_row.user_account_id = approver.id
                  AND grant_row.company_id = request.company_id
                  AND grant_row.role = 'approver'
                  AND (
                    grant_row.valid_from IS NULL
                    OR grant_row.valid_from <= ${occurredAt}::date
                  )
                  AND (
                    grant_row.valid_to IS NULL
                    OR grant_row.valid_to >= ${occurredAt}::date
                  )
              )
            )
        ) recipient ON TRUE
        WHERE request.id = ${requestId}::uuid
          AND request.state = 'pending_approval'
        ON CONFLICT (dedupe_key) DO NOTHING`,
  );
}

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
  kind: Extract<
    LifecycleNotificationKind,
    "decision" | "provisioning_complete"
  >,
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

export function createLifecycleNotificationDispatcher(
  database: Database,
  options: {
    readonly beforeClaim?: (notificationId: string) => Promise<void>;
    readonly mailer?: NotificationMailer;
    readonly now?: () => Date;
    readonly publicOrigin?: string;
    readonly smtpUrl?: string;
    readonly workerId: string;
  },
) {
  const shared = createSharedLifecycleDispatcher({
    ...options,
    pool: (database as unknown as { $client: pg.Pool }).$client,
  });
  return {
    dispatchRequest: async (requestId: string) =>
      shared.drain({ requestId }),
  };
}

export { deliveryErrorCode };
