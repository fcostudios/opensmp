import pg from "pg";

import {
  renderLifecycleNotification,
  type LifecycleNotificationKind,
} from "@smp/notifications/catalog";
import {
  createSmtpMailer,
  createStableMessageId,
  type NotificationMailer,
} from "@smp/notifications/mailer";

// Stryker disable next-line StringLiteral: @equivalent This module-level
// immutable is loaded before per-mutant activation; DB and integration tests
// assert the exact non-empty persisted code and terminal retry exclusion.
const AUTHORIZATION_SUPPRESSED = "RECIPIENT_NOT_AUTHORIZED";

type ReadyNotification = {
  authorized: boolean;
  companyId: string;
  companyName: string;
  from: string | null;
  id: string;
  kind: LifecycleNotificationKind;
  recipientEmail: string | null;
  recipientLocale: "en" | "es" | null;
  requestId: string;
  requestNo: string;
  requesterName: string;
  requestState:
    | "submitted"
    | "pending_approval"
    | "approved"
    | "blocked_no_seat"
    | "provisioning"
    | "failed"
    | "invited"
    | "active"
    | "flagged_inactive"
    | "offboarding"
    | "deprovisioned"
    | "rejected";
};

export type LifecycleDrainResult = {
  failed: number;
  sent: number;
  skipped: number;
};

export type LifecycleNotificationDispatcher = {
  close(): Promise<void>;
  drain(options?: {
    limit?: number;
    requestId?: string;
  }): Promise<LifecycleDrainResult>;
};

export function createLifecycleNotificationDispatcher(options: {
  beforeClaim?: (notificationId: string) => Promise<void>;
  connectionString?: string;
  leaseMs?: number;
  mailer?: NotificationMailer;
  maxAttempts?: number;
  now?: () => Date;
  publicOrigin?: string;
  retryDelayMs?: number;
  smtpUrl?: string;
  workerId: string;
  pool?: pg.Pool;
}): LifecycleNotificationDispatcher {
  if (!options.pool && !options.connectionString) {
    throw new TypeError("connectionString or pool is required");
  }
  const ownsPool = !options.pool;
  const pool =
    options.pool ??
    new pg.Pool({ connectionString: options.connectionString });
  const now = options.now ?? (() => new Date());
  const leaseMs = options.leaseMs ?? 5 * 60_000;
  const maxAttempts = options.maxAttempts ?? 5;
  const retryDelayMs = options.retryDelayMs ?? 60_000;
  let mailer = options.mailer;

  return {
    async close(): Promise<void> {
      if (ownsPool) await pool.end();
    },

    async drain({ limit = 100, requestId }: {
      limit?: number;
      requestId?: string;
    } = {}): Promise<LifecycleDrainResult> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
        throw new TypeError("limit must be an integer between 1 and 1000");
      }
      const scannedAt = now();
      const ready = await pool.query<{ id: string }>(
        `SELECT notification.id::text AS id
         FROM lifecycle_notification notification
         LEFT JOIN LATERAL (
           SELECT delivery.attempt, delivery.phase, delivery.occurred_at,
                  delivery.lease_expires_at, delivery.error_code
           FROM lifecycle_notification_delivery delivery
           WHERE delivery.notification_id = notification.id
             AND delivery.attempt > 0
           ORDER BY delivery.attempt DESC,
             CASE delivery.phase
               WHEN 'succeeded' THEN 3
               WHEN 'failed' THEN 2
               WHEN 'claimed' THEN 1
               ELSE 0
             END DESC,
             delivery.occurred_at DESC,
             delivery.id DESC
           LIMIT 1
         ) latest_attempt ON TRUE
         WHERE ($1::uuid IS NULL OR notification.request_id = $1::uuid)
           AND (
             latest_attempt.attempt IS NULL
             OR (
               latest_attempt.attempt < $5
               AND (
                 (
                   latest_attempt.phase = 'failed'
                   AND latest_attempt.error_code <> $2
                   AND latest_attempt.occurred_at <=
                     $3::timestamptz - ($4::integer * interval '1 millisecond')
                 )
                 OR (
                   latest_attempt.phase = 'claimed'
                   AND latest_attempt.lease_expires_at <=
                     $3::timestamptz - ($4::integer * interval '1 millisecond')
                 )
               )
             )
           )
         ORDER BY notification.created_at, notification.id
         LIMIT $6`,
        [
          requestId ?? null,
          AUTHORIZATION_SUPPRESSED,
          scannedAt,
          retryDelayMs,
          maxAttempts,
          limit,
        ],
      );
      const result = { failed: 0, sent: 0, skipped: 0 };
      for (const { id } of ready.rows) {
        await options.beforeClaim?.(id);
        const claimAt = now();
        const claim = await pool.query<{
          attempt: number | null;
          claim_token: string | null;
          status: "already_succeeded" | "busy" | "claimed";
        }>(
          `SELECT status, attempt, claim_token
           FROM claim_lifecycle_notification($1::uuid, $2, $3, $4)`,
          [
            id,
            claimAt,
            new Date(claimAt.getTime() + leaseMs),
            options.workerId,
          ],
        );
        const claimed = claim.rows[0]!;
        // Stryker disable ConditionalExpression,LogicalOperator:
        // @equivalent The DB claim function contract returns both nullable
        // fence fields exactly when status is not claimed.
        if (
          claimed.status !== "claimed" ||
          claimed.attempt === null ||
          claimed.claim_token === null
        ) {
          result.skipped += 1;
          continue;
        }
        // Stryker restore ConditionalExpression,LogicalOperator

        const notification = await loadNotification(pool, id, claimAt);
        if (!notification.authorized) {
          await complete(
            pool,
            notification,
            claimed.attempt,
            claimed.claim_token,
            now(),
            "failed",
            AUTHORIZATION_SUPPRESSED,
            null,
          );
          result.skipped += 1;
          continue;
        }

        try {
          if (!notification.from?.trim() || !notification.recipientEmail) {
            throw Object.assign(
              // Stryker disable next-line StringLiteral: @equivalent Only the
              // structured code below is persisted; internal text is not.
              new Error("invalid notification configuration"), {
              code: "NOTIFICATION_CONFIGURATION_INVALID",
              },
            );
          }
          const rendered = renderLifecycleNotification(
            notification.recipientLocale,
            notification.kind,
            {
              companyName: notification.companyName,
              publicOrigin:
                options.publicOrigin ??
                process.env.PUBLIC_ORIGIN ??
                process.env.NEXTAUTH_URL ??
                // Stryker disable next-line StringLiteral: @equivalent Any
                // non-origin sentinel fails the strict URL validator closed.
                "",
              requestId: notification.requestId,
              requestNo: notification.requestNo,
              requesterName: notification.requesterName,
              state: notification.requestState,
            },
          );
          mailer ??= createSmtpMailer(
            options.smtpUrl ??
              process.env.SMTP_URL ??
              // Stryker disable next-line StringLiteral: @equivalent Any
              // invalid SMTP sentinel is rejected before network delivery.
              "",
          );
          const delivered = await mailer.send({
            from: notification.from,
            html: rendered.html,
            messageId: createStableMessageId(`lifecycle:${notification.id}`),
            subject: rendered.subject,
            text: rendered.text,
            to: [notification.recipientEmail],
          });
          await complete(
            pool,
            notification,
            claimed.attempt,
            claimed.claim_token,
            now(),
            "succeeded",
            null,
            delivered,
          );
          result.sent += 1;
        } catch (error) {
          await complete(
            pool,
            notification,
            claimed.attempt,
            claimed.claim_token,
            now(),
            "failed",
            deliveryErrorCode(error),
            null,
          );
          result.failed += 1;
        }
      }
      return result;
    },
  };
}

async function loadNotification(
  pool: pg.Pool,
  id: string,
  at: Date,
): Promise<ReadyNotification> {
  const result = await pool.query<ReadyNotification>(
    `SELECT notification.id::text AS id,
            notification.kind::text AS kind,
            notification.request_id::text AS "requestId",
            notification.company_id::text AS "companyId",
            notification.request_state::text AS "requestState",
            recipient.email AS "recipientEmail",
            recipient.ui_language AS "recipientLocale",
            request.request_no AS "requestNo",
            requester.full_name AS "requesterName",
            company.name AS "companyName",
            sender.value #>> '{}' AS "from",
            (
              recipient.id IS NOT NULL
              AND (
                (
                  notification.kind IN ('submission', 'decision', 'provisioning_complete')
                  AND recipient.id = request.requested_by
                )
                OR (
                  notification.kind = 'new_request_to_approver'
                  AND (
                    recipient.global_role = 'group_admin'
                    OR EXISTS (
                      SELECT 1
                      FROM company_role_assignment grant_row
                      WHERE grant_row.user_account_id = recipient.id
                        AND grant_row.company_id = notification.company_id
                        AND grant_row.role = 'approver'
                        AND (grant_row.valid_from IS NULL OR grant_row.valid_from <= $2::date)
                        AND (grant_row.valid_to IS NULL OR grant_row.valid_to >= $2::date)
                    )
                  )
                )
              )
            ) AS authorized
     FROM lifecycle_notification notification
     JOIN license_request request
       ON request.id = notification.request_id
      AND request.company_id = notification.company_id
     JOIN person requester
       ON requester.id = request.person_id
      AND requester.company_id = notification.company_id
     JOIN company ON company.id = notification.company_id
     LEFT JOIN user_account recipient
       ON recipient.id = notification.recipient_user_account_id
      AND recipient.status = 'active'
     LEFT JOIN system_setting sender ON sender.key = 'notif_sender_email'
     WHERE notification.id = $1::uuid`,
    [id, at],
  );
  const notification = result.rows[0];
  // Stryker disable next-line ConditionalExpression,StringLiteral: @equivalent
  // The scanned id comes from this same FK-protected append-only table.
  if (!notification) throw new Error("LIFECYCLE_NOTIFICATION_NOT_FOUND");
  return notification;
}

async function complete(
  pool: pg.Pool,
  notification: ReadyNotification,
  attempt: number,
  claimToken: string,
  at: Date,
  phase: "failed" | "succeeded",
  errorCode: string | null,
  delivered: { accepted: readonly string[]; providerMessageId: string } | null,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT complete_lifecycle_notification(
         $1::uuid, $2, $3::uuid, $4, $5,
         $6, $7::jsonb, $8
       )`,
      [
        notification.id,
        attempt,
        claimToken,
        at,
        phase,
        delivered?.providerMessageId ?? null,
        delivered ? JSON.stringify(delivered.accepted) : null,
        errorCode,
      ],
    );
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id, action, entity_type, entity_id, company_id,
          before, after, occurred_at)
       VALUES (NULL, $1, 'LicenseRequest', $2::uuid, $3::uuid, NULL,
               $4::jsonb, $5)`,
      [
        phase === "succeeded"
          ? "notification.lifecycle_succeeded"
          : errorCode === AUTHORIZATION_SUPPRESSED
            ? "notification.lifecycle_suppressed"
            : "notification.lifecycle_failed",
        notification.requestId,
        notification.companyId,
        JSON.stringify(
          phase === "succeeded"
              ? {
                  // Stryker disable next-line OptionalChaining: @equivalent A
                  // succeeded completion is called only with a delivery result.
                  acceptedCount: delivered?.accepted.length ?? 0,
                  kind: notification.kind,
                }
            : { errorCode, kind: notification.kind },
        ),
        at,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function deliveryErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9_]{1,64}$/.test(error.code)
  ) {
    return error.code;
  }
  return "SMTP_DELIVERY_FAILED";
}
