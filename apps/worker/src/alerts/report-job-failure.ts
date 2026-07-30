import { Pool } from "pg";
import {
  alertSubjectDestination,
  type JobName,
} from "@smp/domain";
import {
  createAlertNotificationOutbox,
  createSmtpMailer,
  createStableMessageId,
  renderAlertNotification,
  type NotificationLocale,
  type NotificationMailer,
} from "@smp/notifications";

export type OperationalAlertType = "credential_failure" | "sync_stale";

type CodedError = {
  code?: unknown;
};

export function classifyJobFailure(error: unknown): OperationalAlertType | null {
  const code = (error as CodedError | null | undefined)?.code;
  switch (code) {
    case "AUTH_FAILED":
    case "CREDENTIAL_FAILURE":
    case "INVALID_CREDENTIALS":
    case "UNAUTHORIZED":
      return "credential_failure";
    case "ETIMEDOUT":
    case "SYNC_STALE":
    case "TIMEOUT":
      return "sync_stale";
    default:
      return null;
  }
}

export type JobFailureAlertInput = {
  companyId?: string;
  failureType: OperationalAlertType;
  jobName: JobName;
  occurredAt: Date;
  vendorAccountId?: string;
};

export type JobFailureAlertResult =
  | { status: "created" }
  | { status: "deduplicated" }
  | { status: "invalid_scope" }
  | { status: "no_matching_rule" };

export type JobFailureAlertReporter = {
  close(): Promise<void>;
  report(input: JobFailureAlertInput): Promise<JobFailureAlertResult>;
};

export function operationalAlertErrorCode(
  originalCode: string,
  outcome: JobFailureAlertResult,
): string {
  if (outcome.status === "no_matching_rule") {
    return `${originalCode}_alert_rule_not_found`;
  }
  if (outcome.status === "invalid_scope") {
    return `${originalCode}_alert_invalid_scope`;
  }
  return originalCode;
}

type AlertRuleRow = {
  id: string;
};

const FIFTEEN_MINUTES_MS = 900_000;

/**
 * Reports operational worker failures through the seeded, enabled AlertRule.
 *
 * A report always selects one exact scope: vendor account, then company, then
 * global. The transaction advisory lock and JSONB equality predicate make a
 * report idempotent for that type/scope/subject/15-minute bucket even when
 * pg-boss retries it concurrently.
 */
export function createJobFailureAlertReporter(
  options: {
    connectionString: string;
    mailer?: NotificationMailer;
    smtpUrl?: string;
    workerId: string;
  },
): JobFailureAlertReporter {
  const pool = new Pool({
    application_name: "ledger-worker",
    connectionString: options.connectionString,
  });
  const outbox = createAlertNotificationOutbox(options.connectionString);
  let mailer = options.mailer;

  return {
    close: async () => {
      await Promise.all([pool.end(), outbox.close()]);
    },

    async report(input): Promise<JobFailureAlertResult> {
      if (!input.vendorAccountId?.trim()) return { status: "invalid_scope" };
      const subject = { vendorAccountId: input.vendorAccountId };
      alertSubjectDestination(input.failureType, subject);
      const rule = await findMatchingRule(pool, input);
      if (!rule) return { status: "no_matching_rule" };
      const bucket = createFailureTimeBucket(input.occurredAt);
      const dedupeKey =
        `${rule.id}:worker-failure:${input.failureType}:${input.vendorAccountId}:${bucket}`;
      const event = await outbox.enqueue({
        alertRuleId: rule.id,
        dedupeKey,
        firedAt: new Date(bucket),
        subjectRef: subject,
      });
      const claim = await outbox.claim({
        alertEventId: event.id,
        at: input.occurredAt,
        leaseMs: 5 * 60_000,
        workerId: options.workerId,
      });
      if (claim.status !== "claimed") return { status: "deduplicated" };
      try {
        const settings = await loadSettings(pool);
        const rendered = renderAlertNotification(
          settings.locale,
          input.failureType,
          subject,
        );
        mailer ??= createSmtpMailer(
          options.smtpUrl ?? process.env.SMTP_URL ?? "",
        );
        const sent = await mailer.send({
          from: settings.from,
          html: rendered.html,
          messageId: createStableMessageId(dedupeKey),
          subject: rendered.subject,
          text: rendered.text,
          to: settings.to,
        });
        await outbox.completeSuccess({
          accepted: sent.accepted,
          alertEventId: event.id,
          at: input.occurredAt,
          attempt: claim.attempt,
          claimToken: claim.claimToken,
          providerMessageId: sent.providerMessageId,
          workerId: options.workerId,
        });
        return {
          status: event.status === "created" ? "created" : "deduplicated",
        };
      } catch (error) {
        await outbox.completeFailure({
          alertEventId: event.id,
          at: input.occurredAt,
          attempt: claim.attempt,
          claimToken: claim.claimToken,
          errorCode: errorCode(error),
          workerId: options.workerId,
        });
        throw error;
      }
    },
  };
}

type AlertSettings = {
  from: string;
  locale: NotificationLocale;
  to: readonly string[];
};

async function loadSettings(pool: Pool): Promise<AlertSettings> {
  const result = await pool.query<{ key: string; value: unknown }>(
    `SELECT key, value
     FROM system_setting
     WHERE key = ANY($1)`,
    [[
      "notif_sender_email",
      "notif_escalation_email",
      "default_language",
    ]],
  );
  const settings = new Map(result.rows.map(({ key, value }) => [key, value]));
  const from = settings.get("notif_sender_email");
  const escalation = settings.get("notif_escalation_email");
  if (typeof from !== "string" || typeof escalation !== "string") {
    throw Object.assign(new Error("notification settings are invalid"), {
      code: "NOTIFICATION_SETTINGS_INVALID",
    });
  }
  return {
    from,
    locale: settings.get("default_language") === "en" ? "en-US" : "es-EC",
    to: [escalation],
  };
}

function errorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code.replaceAll(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) ||
      "ALERT_DELIVERY_FAILED";
  }
  return "ALERT_DELIVERY_FAILED";
}

export function createFailureTimeBucket(occurredAt: Date): string {
  const time = occurredAt.getTime();
  if (!Number.isFinite(time)) throw new TypeError("occurredAt must be a valid date");
  return new Date(Math.floor(time / FIFTEEN_MINUTES_MS) * FIFTEEN_MINUTES_MS).toISOString();
}

async function findMatchingRule(
  client: Pool,
  input: JobFailureAlertInput,
): Promise<AlertRuleRow | undefined> {
  const result = await client.query<AlertRuleRow>(
    `SELECT id
     FROM alert_rule
     WHERE enabled
       AND type = $1::alert_rule_type_enum
       AND (
         (scope_kind = 'vendor_account' AND vendor_account_id = $2::uuid)
         OR (scope_kind = 'company' AND company_id = $3::uuid)
         OR scope_kind = 'global'
       )
     ORDER BY CASE scope_kind
       WHEN 'vendor_account' THEN 0
       WHEN 'company' THEN 1
       ELSE 2
     END, created_at, id
     LIMIT 1`,
    [input.failureType, input.vendorAccountId ?? null, input.companyId ?? null],
  );
  return result.rows[0];
}
