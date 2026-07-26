import { Pool, type PoolClient } from "pg";
import type { JobName } from "@smp/domain";

export type OperationalAlertType = "credential_failure" | "sync_stale";

type CodedError = {
  code?: unknown;
};

export function classifyJobFailure(error: unknown): OperationalAlertType | null {
  const code = error && typeof error === "object" ? (error as CodedError).code : undefined;
  if (typeof code !== "string") return null;

  if (["AUTH_FAILED", "CREDENTIAL_FAILURE", "INVALID_CREDENTIALS", "UNAUTHORIZED"].includes(code)) {
    return "credential_failure";
  }
  if (["ETIMEDOUT", "SYNC_STALE", "TIMEOUT"].includes(code)) return "sync_stale";
  return null;
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
  | { status: "no_matching_rule" };

export type JobFailureAlertReporter = {
  close(): Promise<void>;
  report(input: JobFailureAlertInput): Promise<JobFailureAlertResult>;
};

type AlertRuleRow = {
  id: string;
};

type AlertEventRow = {
  id: string;
};

type FailureSubject = {
  bucket: string;
  companyId: string | null;
  failureType: OperationalAlertType;
  jobName: JobName;
  vendorAccountId: string | null;
};

const FIFTEEN_MINUTES_MS = 15 * 60 * 1_000;

/**
 * Reports operational worker failures through the seeded, enabled AlertRule.
 *
 * A report always selects one exact scope: vendor account, then company, then
 * global. The transaction advisory lock and JSONB equality predicate make a
 * report idempotent for that type/scope/subject/15-minute bucket even when
 * pg-boss retries it concurrently.
 */
export function createJobFailureAlertReporter(connectionString: string): JobFailureAlertReporter {
  const pool = new Pool({
    application_name: "ledger-worker",
    connectionString,
  });

  return {
    close: async () => {
      await pool.end();
    },

    async report(input): Promise<JobFailureAlertResult> {
      const subject = createFailureSubject(input);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `worker-alert:${JSON.stringify(subject)}`,
        ]);

        const rule = await findMatchingRule(client, input);
        if (!rule) {
          await client.query("COMMIT");
          return { status: "no_matching_rule" };
        }

        const existing = await client.query<AlertEventRow>(
          `SELECT id
           FROM alert_event
           WHERE alert_rule_id = $1
             AND subject_ref = $2::jsonb
           FOR UPDATE`,
          [rule.id, JSON.stringify(subject)],
        );
        if (existing.rowCount) {
          await client.query("COMMIT");
          return { status: "deduplicated" };
        }

        await client.query(
          `INSERT INTO alert_event (alert_rule_id, fired_at, subject_ref, notified)
           VALUES ($1, $2, $3::jsonb, '[]'::jsonb)`,
          [rule.id, input.occurredAt, JSON.stringify(subject)],
        );
        await client.query("COMMIT");
        return { status: "created" };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export function createFailureSubject(input: JobFailureAlertInput): FailureSubject {
  return {
    bucket: createFailureTimeBucket(input.occurredAt),
    companyId: input.companyId ?? null,
    failureType: input.failureType,
    jobName: input.jobName,
    vendorAccountId: input.vendorAccountId ?? null,
  };
}

export function createFailureTimeBucket(occurredAt: Date): string {
  const time = occurredAt.getTime();
  if (!Number.isFinite(time)) throw new TypeError("occurredAt must be a valid date");
  return new Date(Math.floor(time / FIFTEEN_MINUTES_MS) * FIFTEEN_MINUTES_MS).toISOString();
}

async function findMatchingRule(
  client: PoolClient,
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
