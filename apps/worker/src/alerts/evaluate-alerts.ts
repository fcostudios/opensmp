import {
  approvalAgingThresholdSchema,
  alertRuleContractSchema,
  type AlertType,
} from "@smp/contracts/alerts";
import {
  evaluateAlertRule,
  evaluateApprovalAging,
  businessDaysBetween,
  businessDaysElapsedInMonth,
  ecuadorOperatingDate,
  failedJob,
  isEcuadorBusinessDayDeadlineOverdue,
  successfulJob,
  type AlertFacts,
  type ApprovalAgingStage,
  type EcuadorBusinessCalendar,
  type JobResult,
} from "@smp/domain";
import {
  createAlertNotificationOutbox,
  createStableMessageId,
  createSmtpMailer,
  renderApprovalAgingNotification,
  renderAlertNotification,
  type AlertNotificationOutbox,
  type NotificationLocale,
  type NotificationMailer,
} from "@smp/notifications";
import pg from "pg";

import { loadLowPoolFacts } from "./low-pool-facts.js";

type RuleRow = {
  company_id: string | null;
  enabled: boolean;
  id: string;
  scope_kind: "company" | "global" | "vendor_account";
  threshold: unknown;
  type: AlertType;
  vendor_account_id: string | null;
};

type AlertSettings = {
  escalationEmail: string;
  escalationLocale: "en" | "es";
  escalationUserAccountId: string | null;
  from: string;
  locale: NotificationLocale;
};

type ApprovalAgingRecipient = {
  email: string;
  locale: "en" | "es" | null;
  name: string;
  userAccountId: string;
};

type ApprovalAgingRequest = {
  approvers: ApprovalAgingRecipient[];
  company_id: string;
  company_name: string;
  pending_since: Date;
  request_id: string;
  request_no: string;
};

export type AlertEvaluationJob = {
  close(): Promise<void>;
  run(at: Date): Promise<JobResult>;
};

export type ApprovalRecipientDeliveryContext = {
  alertEventId: string;
  recipientKey: string;
  requestId: string;
  stage: ApprovalAgingStage;
};

export function createAlertEvaluationJob(options: {
  beforeApprovalRecipientDelivery?: (
    context: ApprovalRecipientDeliveryContext,
  ) => Promise<void>;
  calendar?: EcuadorBusinessCalendar;
  connectionString: string;
  mailer?: NotificationMailer;
  smtpUrl?: string;
  workerId: string;
}): AlertEvaluationJob {
  const pool = new pg.Pool({ connectionString: options.connectionString });
  const outbox = createAlertNotificationOutbox(options.connectionString);
  let mailer = options.mailer;
  const resolveMailer = () => {
    // Stryker disable StringLiteral:
    // @equivalent Both the empty fallback and Stryker's non-URL replacement
    // throw synchronously in createSmtpMailer before network I/O, and this job
    // maps either non-coded constructor error to ALERT_EVALUATION_FAILED.
    mailer ??= createSmtpMailer(
      options.smtpUrl ?? process.env.SMTP_URL ?? "",
    );
    // Stryker restore StringLiteral
    return mailer;
  };

  return {
    async close() {
      await Promise.all([pool.end(), outbox.close()]);
    },

    async run(at) {
      const windowStart = breachWindowStart(at);
      const rules = await pool.query<RuleRow>(
        `SELECT id, type::text, scope_kind::text, company_id,
                vendor_account_id, threshold, enabled
         FROM alert_rule
         WHERE enabled
         ORDER BY created_at, id`,
      );
      let processed = 0;
      let firstFailure:
        | { alertRuleId: string; errorCode: string }
        | undefined;
      for (const row of rules.rows) {
        try {
          const parsed = alertRuleContractSchema.parse({
            enabled: row.enabled,
            threshold: row.threshold,
            type: row.type,
          });
          if (row.type === "approval_aging") {
            const threshold = approvalAgingThresholdSchema.parse(
              parsed.threshold,
            );
            processed += await processApprovalAgingRule({
              at,
              beforeRecipientDelivery:
                options.beforeApprovalRecipientDelivery,
              calendar: options.calendar ?? { holidays: new Set() },
              mailer: resolveMailer,
              outbox,
              pool,
              rule: row,
              settings: await loadSettings(pool),
              threshold,
              windowStart,
              workerId: options.workerId,
            });
            continue;
          }
          const facts = await gatherFacts(
            pool,
            row,
            windowStart,
            options.calendar ?? { holidays: new Set() },
          );
          for (const fact of facts) {
            const evaluation = evaluateAlertRule(parsed, fact, windowStart);
            if (!evaluation) continue;
            const eventDedupeKey = `${row.id}:breach:${evaluation.dedupeKey}`;
            const event = await outbox.enqueue({
              alertRuleId: row.id,
              dedupeKey: eventDedupeKey,
              firedAt: windowStart,
              subjectRef: evaluation.subjectRef,
            });
            const claim = await outbox.claim({
              alertEventId: event.id,
              at,
              leaseMs: 5 * 60_000,
              workerId: options.workerId,
            });
            if (claim.status === "busy") {
              throw Object.assign(new Error("alert delivery is busy"), {
                code: "ALERT_DELIVERY_BUSY",
              });
            }
            if (claim.status === "already_succeeded") continue;
            try {
              const settings = await loadSettings(pool);
              const rendered = renderAlertNotification(
                settings.locale,
                row.type,
                evaluation.subjectRef,
              );
              const recipients = row.type === "blocked_no_seat"
                ? await loadActiveGroupAdminEmails(pool)
                : [settings.escalationEmail];
              const result = await resolveMailer().send({
                from: settings.from,
                html: rendered.html,
                messageId: createStableMessageId(eventDedupeKey),
                subject: rendered.subject,
                text: rendered.text,
                to: recipients,
              });
              await outbox.completeSuccess({
                accepted: result.accepted,
                alertEventId: event.id,
                at,
                attempt: claim.attempt,
                claimToken: claim.claimToken,
                providerMessageId: result.providerMessageId,
                workerId: options.workerId,
              });
              processed += 1;
            } catch (error) {
              await outbox.completeFailure({
                alertEventId: event.id,
                at,
                attempt: claim.attempt,
                claimToken: claim.claimToken,
                errorCode: errorCode(error),
                workerId: options.workerId,
              });
              throw error;
            }
          }
        } catch (error) {
          firstFailure ??= {
            alertRuleId: row.id,
            errorCode: errorCode(error),
          };
        }
      }
      if (firstFailure) {
        return failedJob(
          firstFailure.alertRuleId,
          firstFailure.errorCode,
          processed,
        );
      }
      return successfulJob(processed);
    },
  };
}

async function loadActiveGroupAdminEmails(pool: pg.Pool): Promise<string[]> {
  const result = await pool.query<{ email: string }>(
    `SELECT email FROM user_account
     WHERE status='active' AND global_role='group_admin'
     ORDER BY id`,
  );
  if (result.rows.length === 0) {
    throw Object.assign(new Error("blocked alert has no active Group Admin"), {
      code: "BLOCKED_ALERT_RECIPIENT_MISSING",
    });
  }
  return result.rows.map(({ email }) => email);
}

export function breachWindowStart(at: Date): Date {
  const time = at.getTime();
  if (!Number.isFinite(time)) throw new TypeError("at must be a valid date");
  return new Date(Math.floor(time / (15 * 60_000)) * 15 * 60_000);
}

async function loadSettings(pool: pg.Pool): Promise<AlertSettings> {
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
  const language = settings.get("default_language");
  if (typeof from !== "string" || typeof escalation !== "string") {
    throw Object.assign(new Error("notification settings are invalid"), {
      code: "NOTIFICATION_SETTINGS_INVALID",
    });
  }
  const escalationUser = await pool.query<{
    id: string;
    ui_language: "en" | "es";
  }>(
    `SELECT id, ui_language::text
     FROM user_account
     WHERE status = 'active' AND lower(email) = lower($1)
     ORDER BY id
     LIMIT 1`,
    [escalation],
  );
  const defaultLocales = resolveNotificationLocale(language);
  return {
    escalationEmail: escalation,
    escalationLocale:
      escalationUser.rows[0]?.ui_language ??
      defaultLocales.database,
    escalationUserAccountId: escalationUser.rows[0]?.id ?? null,
    from,
    locale: defaultLocales.notification,
  };
}

export function resolveNotificationLocale(language: unknown): {
  database: "en" | "es";
  notification: NotificationLocale;
} {
  return language === "en"
    ? { database: "en", notification: "en-US" }
    : { database: "es", notification: "es-EC" };
}

async function processApprovalAgingRule(input: {
  at: Date;
  beforeRecipientDelivery?: (
    context: ApprovalRecipientDeliveryContext,
  ) => Promise<void>;
  calendar: EcuadorBusinessCalendar;
  mailer(): NotificationMailer;
  outbox: AlertNotificationOutbox;
  pool: pg.Pool;
  rule: RuleRow;
  settings: AlertSettings;
  threshold: {
    escalationHours: number;
    hours: number;
  };
  windowStart: Date;
  workerId: string;
}): Promise<number> {
  const authorizationDate = ecuadorOperatingDate(input.at);
  const requests = await loadApprovalAgingRequests(
    input.pool,
    input.rule,
    authorizationDate,
  );
  let processed = 0;
  for (const request of requests) {
    const breachStartedAt = request.pending_since.toISOString();
    const dedupePrefix =
      `${input.rule.id}:approval-aging:${request.request_id}:` +
      `${breachStartedAt}:`;
    const stages = evaluateApprovalAging({
      calendar: input.calendar,
      clock: { now: () => input.at },
      emittedStages: new Set<ApprovalAgingStage>(),
      pendingSince: request.pending_since,
      threshold: {
        escalationBusinessHours: input.threshold.escalationHours,
        reminderBusinessHours: input.threshold.hours,
      },
    });
    for (const stage of stages) {
      const eventDedupeKey = `${dedupePrefix}${stage}`;
      const recipients =
        stage === "reminder"
          ? request.approvers.map((recipient) => ({
              email: recipient.email,
              key: `user:${recipient.userAccountId}`,
              locale: resolveNotificationLocale(recipient.locale).database,
              userAccountId: recipient.userAccountId,
            }))
          : [{
              email: input.settings.escalationEmail,
              key:
                input.settings.escalationUserAccountId === null
                  ? `email:${input.settings.escalationEmail.toLowerCase()}`
                  : `user:${input.settings.escalationUserAccountId}`,
              locale: input.settings.escalationLocale,
              userAccountId: input.settings.escalationUserAccountId,
            }];
      const suppressed = stage === "reminder" && recipients.length === 0;
      const event = await input.outbox.enqueue({
        alertRuleId: input.rule.id,
        deliveries: recipients,
        dedupeKey: eventDedupeKey,
        firedAt: input.windowStart,
        notified: suppressed
          ? {
              breachStartedAt,
              reason: "NO_CURRENT_APPROVERS",
              stage,
              status: "suppressed",
            }
          : {
              breachStartedAt,
              recipientCount: recipients.length,
              stage,
              status: "pending",
            },
        subjectRef: {
          breachStartedAt,
          requestId: request.request_id,
          stage,
        },
      });
      const queuedRecipients = await input.outbox.listRecipients(event.id);
      if (queuedRecipients.length === 0) {
        if (event.status === "created") processed += 1;
        continue;
      }
      let deliveredStage = false;
      for (const queued of queuedRecipients) {
        const claim = await input.outbox.claim({
          alertEventId: event.id,
          at: input.at,
          leaseMs: 5 * 60_000,
          recipientKey: queued.key,
          workerId: input.workerId,
        });
        if (claim.status === "busy") {
          throw Object.assign(new Error(), {
            code: "ALERT_DELIVERY_BUSY",
          });
        }
        if (claim.status === "already_succeeded") continue;
        await input.beforeRecipientDelivery?.({
          alertEventId: event.id,
          recipientKey: queued.key,
          requestId: request.request_id,
          stage,
        });
        const currentRecipient =
          stage === "reminder" && queued.userAccountId
            ? await loadCurrentApprover(
                input.pool,
                request.company_id,
                queued.userAccountId,
                authorizationDate,
              )
            : null;
        if (stage === "reminder" && currentRecipient === null) {
          await input.outbox.completeSuccess({
            accepted: [],
            alertEventId: event.id,
            at: input.at,
            attempt: claim.attempt,
            claimToken: claim.claimToken,
            providerMessageId: "suppressed:recipient-not-authorized",
            recipientKey: queued.key,
            workerId: input.workerId,
          });
          continue;
        }
        const currentBreach = await loadCurrentApprovalBreach(
          input.pool,
          event.id,
          request.company_id,
        );
        if (!currentBreach) {
          await input.outbox.completeSuccess({
            accepted: [],
            alertEventId: event.id,
            at: input.at,
            attempt: claim.attempt,
            claimToken: claim.claimToken,
            providerMessageId: "suppressed:approval-breach-not-current",
            recipientKey: queued.key,
            workerId: input.workerId,
          });
          continue;
        }
        const deliveryRecipient =
          currentRecipient ?? {
            email: queued.email,
            locale: queued.locale,
            name: request.approvers.map(({ name }) => name).join(", "),
            userAccountId: queued.userAccountId ?? "",
          };
        const rendered = renderApprovalAgingNotification(
          deliveryRecipient.locale === "en" ? "en-US" : "es-EC",
          stage,
          {
            approverName:
              stage === "reminder"
                ? deliveryRecipient.name
                : request.approvers.map(({ name }) => name).join(", "),
            companyName: request.company_name,
            requestNo: request.request_no,
          },
        );
        try {
          const result = await input.mailer().send({
            from: input.settings.from,
            html: rendered.html,
            messageId: createStableMessageId(
              `${eventDedupeKey}:${queued.key}`,
            ),
            subject: rendered.subject,
            text: rendered.text,
            to: [deliveryRecipient.email],
          });
          await input.outbox.completeSuccess({
            accepted: result.accepted,
            alertEventId: event.id,
            at: input.at,
            attempt: claim.attempt,
            claimToken: claim.claimToken,
            providerMessageId: result.providerMessageId,
            recipientKey: queued.key,
            workerId: input.workerId,
          });
          deliveredStage = true;
        } catch (error) {
          await input.outbox.completeFailure({
            alertEventId: event.id,
            at: input.at,
            attempt: claim.attempt,
            claimToken: claim.claimToken,
            errorCode: errorCode(error),
            recipientKey: queued.key,
            workerId: input.workerId,
          });
          throw error;
        }
      }
      if (deliveredStage) processed += 1;
    }
  }
  return processed;
}

async function loadApprovalAgingRequests(
  pool: pg.Pool,
  rule: RuleRow,
  authorizationDate: string,
): Promise<ApprovalAgingRequest[]> {
  const result = await pool.query<ApprovalAgingRequest>(
    `SELECT request.id AS request_id,
            request.request_no,
            request.company_id,
            company.name AS company_name,
            state_entry.occurred_at AS pending_since,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'email', recipient.email,
                  'locale', recipient.locale,
                  'name', recipient.name,
                  'userAccountId', recipient.user_account_id
                )
                ORDER BY recipient.email
              ) FILTER (WHERE recipient.email IS NOT NULL),
              '[]'::jsonb
            ) AS approvers
     FROM license_request request
     JOIN company
       ON company.id = request.company_id
     JOIN LATERAL (
       SELECT transition.occurred_at
       FROM request_transition transition
       WHERE transition.request_id = request.id
         AND transition.to_state = 'pending_approval'
       ORDER BY transition.occurred_at DESC, transition.id DESC
       LIMIT 1
     ) state_entry ON true
     LEFT JOIN LATERAL (
       SELECT DISTINCT approver.id AS user_account_id,
              approver.email,
              approver.ui_language::text AS locale,
              COALESCE(approver_person.full_name, approver.email) AS name
       FROM company_role_assignment grant_row
       JOIN user_account approver
         ON approver.id = grant_row.user_account_id
        AND approver.status = 'active'
       LEFT JOIN person approver_person
         ON approver_person.id = approver.person_id
        AND approver_person.company_id = request.company_id
       WHERE grant_row.company_id = request.company_id
         AND grant_row.role = 'approver'
         AND (grant_row.valid_from IS NULL OR grant_row.valid_from <= $3::date)
         AND (grant_row.valid_to IS NULL OR grant_row.valid_to >= $3::date)
     ) recipient ON true
     WHERE request.state::text = 'pending_approval'
       AND ($1::uuid IS NULL OR request.company_id = $1)
       AND ($2::uuid IS NULL OR request.vendor_account_id = $2)
     GROUP BY request.id, request.request_no, request.company_id, company.name,
              state_entry.occurred_at
     ORDER BY request.id`,
    [rule.company_id, rule.vendor_account_id, authorizationDate],
  );
  return result.rows;
}

async function loadCurrentApprovalBreach(
  pool: pg.Pool,
  alertEventId: string,
  companyId: string,
): Promise<boolean> {
  const result = await pool.query<{
    actual_breach_started_at: Date;
    expected_breach_started_at: string | null;
  }>(
    `SELECT state_entry.occurred_at AS actual_breach_started_at,
            event.subject_ref->>'breachStartedAt'
              AS expected_breach_started_at
     FROM alert_event event
     JOIN license_request request
       ON request.id::text = event.subject_ref->>'requestId'
      AND request.company_id = $2
     JOIN LATERAL (
       SELECT transition.occurred_at
       FROM request_transition transition
       WHERE transition.request_id = request.id
         AND transition.to_state = 'pending_approval'
       ORDER BY transition.occurred_at DESC, transition.id DESC
       LIMIT 1
     ) state_entry ON true
     WHERE event.id = $1
       AND request.state::text = 'pending_approval'`,
    [alertEventId, companyId],
  );
  const row = result.rows[0];
  return row !== undefined &&
    row.expected_breach_started_at ===
      row.actual_breach_started_at.toISOString();
}

async function loadCurrentApprover(
  pool: pg.Pool,
  companyId: string,
  userAccountId: string,
  authorizationDate: string,
): Promise<ApprovalAgingRecipient | null> {
  const result = await pool.query<{
    email: string;
    locale: "en" | "es" | null;
    name: string;
    userAccountId: string;
  }>(
    `SELECT approver.id::text AS "userAccountId",
            approver.email,
            approver.ui_language::text AS locale,
            COALESCE(person.full_name, approver.email) AS name
     FROM user_account approver
     JOIN company_role_assignment grant_row
       ON grant_row.user_account_id = approver.id
      AND grant_row.company_id = $1
      AND grant_row.role = 'approver'
      AND (grant_row.valid_from IS NULL OR grant_row.valid_from <= $3::date)
      AND (grant_row.valid_to IS NULL OR grant_row.valid_to >= $3::date)
     LEFT JOIN person
       ON person.id = approver.person_id
      AND person.company_id = $1
     WHERE approver.id = $2
       AND approver.status = 'active'
     ORDER BY grant_row.id
     LIMIT 1`,
    [companyId, userAccountId, authorizationDate],
  );
  return result.rows[0] ?? null;
}

async function gatherFacts(
  pool: pg.Pool,
  rule: RuleRow,
  at: Date,
  calendar: EcuadorBusinessCalendar,
): Promise<AlertFacts[]> {
  if (!isAlertRuleScopeAllowed(rule)) return [];
  switch (rule.type) {
    case "low_pool":
      return await loadLowPoolFacts(pool, {
        at,
        vendorAccountId: rule.vendor_account_id,
      });
    case "approval_aging":
      return await requestAgeFacts(pool, rule, at, "pending_approval");
    case "blocked_no_seat":
      return await requestBusinessDayFacts(pool, rule, at, calendar);
    case "invite_unaccepted":
      return await requestAgeFacts(pool, rule, at, "invited");
    case "deprovision_overdue":
      return await deprovisionOverdueFacts(pool, rule, at, calendar);
    case "provisioning_failure":
      return await booleanSubjectFacts(
        pool,
        rule,
        `SELECT request.id AS subject_id
         FROM provisioning_action action
         JOIN license_request request ON request.id = action.request_id
         WHERE action.status IN ('failed', 'verification_failed')
           AND ($1::uuid IS NULL OR request.company_id = $1)
           AND ($2::uuid IS NULL OR action.vendor_account_id = $2)`,
        "failed",
        "requestId",
      );
    case "credential_failure":
      return await booleanSubjectFacts(
        pool,
        rule,
        `SELECT DISTINCT credential.vendor_account_id AS subject_id
         FROM integration_credential credential
         WHERE credential.status = 'active' AND credential.health = 'auth_failed'
           AND $1::uuid IS NULL
           AND ($2::uuid IS NULL OR credential.vendor_account_id = $2)`,
        "failed",
        "vendorAccountId",
      );
    case "register_drift":
      return await booleanSubjectFacts(
        pool,
        rule,
        `SELECT reconciliation.id AS subject_id
         FROM reconciliation
         WHERE reconciliation.status = 'open'
           AND reconciliation.variance_usd IS DISTINCT FROM 0
           AND $1::uuid IS NULL
           AND ($2::uuid IS NULL OR reconciliation.vendor_account_id = $2)`,
        "drifted",
        "reconciliationId",
      );
    case "sync_stale":
      return await staleSyncFacts(pool, rule, at);
    case "close_missed":
      return await closeMissedFacts(pool, rule, at, calendar);
    default: {
      const exhaustive: never = rule.type;
      throw new TypeError(`unsupported alert type: ${exhaustive}`);
    }
  }
}

function isAlertRuleScopeAllowed(rule: RuleRow): boolean {
  return rule.type !== "low_pool" || rule.scope_kind !== "company";
}

async function requestBusinessDayFacts(
  pool: pg.Pool,
  rule: RuleRow,
  at: Date,
  calendar: EcuadorBusinessCalendar,
): Promise<AlertFacts[]> {
  const result = await pool.query<{ created_at: Date; subject_id: string }>(
    `SELECT request.id AS subject_id, state_entry.occurred_at AS created_at
     FROM license_request request
     JOIN LATERAL (
       SELECT transition.occurred_at
       FROM request_transition transition
       WHERE transition.request_id = request.id
         AND transition.to_state = 'blocked_no_seat'
       ORDER BY transition.occurred_at DESC, transition.id DESC
       LIMIT 1
     ) state_entry ON true
     WHERE request.state::text = 'blocked_no_seat'
       AND ($1::uuid IS NULL OR request.company_id = $1)
       AND ($2::uuid IS NULL OR request.vendor_account_id = $2)`,
    [rule.company_id, rule.vendor_account_id],
  );
  return result.rows.map(({ created_at, subject_id }) => ({
    businessDaysElapsed: businessDaysBetween(created_at, at, calendar),
    subject: { requestId: subject_id },
  }));
}

async function closeMissedFacts(
  pool: pg.Pool,
  rule: RuleRow,
  at: Date,
  calendar: EcuadorBusinessCalendar,
): Promise<AlertFacts[]> {
  if (rule.company_id || rule.vendor_account_id) return [];
  const operatingDate = ecuadorOperatingDate(at);
  const periodDate = new Date(`${operatingDate.slice(0, 7)}-01T00:00:00.000Z`);
  periodDate.setUTCMonth(periodDate.getUTCMonth() - 1);
  const period = periodDate.toISOString().slice(0, 7);
  const result = await pool.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM close_run WHERE period = $1) AS exists",
    [period],
  );
  if (result.rows[0]!.exists) return [];
  return [{
    businessDaysElapsed: businessDaysElapsedInMonth(at, calendar),
    subject: { period },
  }];
}

async function requestAgeFacts(
  pool: pg.Pool,
  rule: RuleRow,
  at: Date,
  state: string,
): Promise<AlertFacts[]> {
  const result = await pool.query<{ age: number; subject_id: string }>(
    `SELECT request.id AS subject_id,
            EXTRACT(EPOCH FROM ($1::timestamptz - state_entry.occurred_at)) /
              3600::double precision AS age
     FROM license_request request
     JOIN LATERAL (
       SELECT transition.occurred_at
       FROM request_transition transition
       WHERE transition.request_id = request.id
         AND transition.to_state = $2
       ORDER BY transition.occurred_at DESC, transition.id DESC
       LIMIT 1
     ) state_entry ON true
     WHERE request.state::text = $2
       AND ($3::uuid IS NULL OR request.company_id = $3)
       AND ($4::uuid IS NULL OR request.vendor_account_id = $4)`,
    [at, state, rule.company_id, rule.vendor_account_id],
  );
  return result.rows.map((row) => ({
    ageHours: row.age,
    subject: { requestId: row.subject_id },
  }));
}

async function deprovisionOverdueFacts(
  pool: pg.Pool,
  rule: RuleRow,
  at: Date,
  calendar: EcuadorBusinessCalendar,
): Promise<AlertFacts[]> {
  const result = await pool.query<{ started_at: Date; subject_id: string }>(
    `SELECT request.id AS subject_id, state_entry.occurred_at AS started_at
     FROM license_request request
     JOIN LATERAL (
       SELECT transition.occurred_at
       FROM request_transition transition
       WHERE transition.request_id = request.id
         AND transition.to_state = 'offboarding'
       ORDER BY transition.occurred_at DESC, transition.id DESC
       LIMIT 1
     ) state_entry ON true
     JOIN LATERAL (
       SELECT action.id, action.raw_request, action.status
       FROM provisioning_action action
       WHERE action.request_id = request.id
         AND action.vendor_account_id = request.vendor_account_id
         AND (
           action.kind = 'remove'
           OR (
             action.kind = 'checklist'
             AND action.raw_request->>'operation' = 'deprovision'
           )
         )
       ORDER BY action.created_at DESC, action.id DESC
       LIMIT 1
     ) removal
       ON removal.status = 'pending'
      AND removal.raw_request #>> '{context,endReason}' = 'left_company'
      AND removal.raw_request #>> '{context,requestId}' = request.id::text
     JOIN LATERAL (
       SELECT assignment.id
       FROM license_assignment assignment
       WHERE assignment.source_request_id = request.id
         AND assignment.person_id = request.person_id
         AND assignment.company_id = request.company_id
         AND assignment.vendor_account_id = request.vendor_account_id
         AND assignment.license_type_id = request.license_type_id
         AND assignment.ended_on IS NULL
         AND EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(
             CASE
               WHEN jsonb_typeof(
                 removal.raw_request #> '{context,assignmentIds}'
               ) = 'array'
               THEN removal.raw_request #> '{context,assignmentIds}'
               ELSE '[]'::jsonb
             END
           ) action_assignment(id)
           WHERE action_assignment.id = assignment.id::text
         )
       ORDER BY assignment.started_on DESC,
                assignment.created_at DESC,
                assignment.id DESC
       LIMIT 1
     ) relevant_assignment ON true
     WHERE request.state::text = 'offboarding'
       AND ($1::uuid IS NULL OR request.company_id = $1)
       AND ($2::uuid IS NULL OR request.vendor_account_id = $2)
     ORDER BY request.id`,
    [rule.company_id, rule.vendor_account_id],
  );
  return result.rows.map(({ started_at, subject_id }) => ({
    deadlineExceeded: isEcuadorBusinessDayDeadlineOverdue(
      started_at,
      at,
      calendar,
    ),
    subject: { requestId: subject_id },
  }));
}

async function booleanSubjectFacts(
  pool: pg.Pool,
  rule: RuleRow,
  query: string,
  fact: "drifted" | "failed",
  subjectKey: "reconciliationId" | "requestId" | "vendorAccountId",
): Promise<AlertFacts[]> {
  const result = await pool.query<{ subject_id: string }>(query, [
    rule.company_id,
    rule.vendor_account_id,
  ]);
  return result.rows.map(({ subject_id }) => {
    const subject =
      subjectKey === "requestId"
        ? { requestId: subject_id }
        : subjectKey === "vendorAccountId"
          ? { vendorAccountId: subject_id }
          : { reconciliationId: subject_id };
    return fact === "failed"
      ? { failed: true, subject }
      : { drifted: true, subject };
  });
}

async function staleSyncFacts(
  pool: pg.Pool,
  rule: RuleRow,
  at: Date,
): Promise<AlertFacts[]> {
  const result = await pool.query<{ age_hours: number; subject_id: string }>(
    `SELECT account.id AS subject_id,
            EXTRACT(EPOCH FROM ($1::timestamptz - max(activity.synced_at))) / 3600
              AS age_hours
     FROM vendor_account account
     JOIN activity_record activity ON activity.vendor_account_id = account.id
     WHERE account.status = 'active'
       AND $2::uuid IS NULL
       AND ($3::uuid IS NULL OR account.id = $3)
     GROUP BY account.id`,
    [at, rule.company_id, rule.vendor_account_id],
  );
  return result.rows.map(({ age_hours, subject_id }) => ({
    ageHours: age_hours,
    subject: { vendorAccountId: subject_id },
  }));
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code.replaceAll(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "ALERT_EVALUATION_FAILED";
  }
  return "ALERT_EVALUATION_FAILED";
}
