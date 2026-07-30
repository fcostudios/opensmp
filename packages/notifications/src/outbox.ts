import pg, { type PoolClient } from "pg";

export type AlertEventInput = {
  alertRuleId: string;
  dedupeKey: string;
  deliveries?: readonly {
    email: string;
    key: string;
    locale: "en" | "es";
    userAccountId: string | null;
  }[];
  firedAt: Date;
  notified?: unknown;
  subjectRef: Readonly<Record<string, string>>;
};

export type AlertNotificationOutbox = {
  claim(input: {
    alertEventId: string;
    at: Date;
    leaseMs: number;
    recipientKey?: string;
    workerId: string;
  }): Promise<
    | { attempt: number; claimToken: string; status: "claimed" }
    | { status: "already_succeeded" }
    | { status: "busy" }
  >;
  close(): Promise<void>;
  completeFailure(input: {
    alertEventId: string;
    at: Date;
    attempt: number;
    claimToken: string;
    errorCode: string;
    recipientKey?: string;
    workerId: string;
  }): Promise<void>;
  completeSuccess(input: {
    accepted: readonly string[];
    alertEventId: string;
    at: Date;
    attempt: number;
    claimToken: string;
    providerMessageId: string;
    recipientKey?: string;
    workerId: string;
  }): Promise<void>;
  enqueue(input: AlertEventInput): Promise<
    | { id: string; status: "created" }
    | { id: string; postgresCode: "23505"; status: "replayed" }
  >;
  listRecipients(alertEventId: string): Promise<{
    email: string;
    key: string;
    locale: "en" | "es";
    userAccountId: string | null;
  }[]>;
  listReadyEventIds(at: Date): Promise<string[]>;
};

export function createAlertNotificationOutbox(
  connectionString: string,
): AlertNotificationOutbox {
  const pool = new pg.Pool({ connectionString });
  return {
    async claim(input) {
      assertDate(input.at, "at");
      const recipientKey = input.recipientKey ?? "default";
      if (!Number.isInteger(input.leaseMs) || input.leaseMs <= 0) {
        throw new RangeError("leaseMs must be a positive integer");
      }
      return await inTransaction(pool, async (client) => {
        await client.query(
          // Stryker disable next-line StringLiteral:
          // @equivalent The SECURITY DEFINER recipient claim also acquires the
          // same recipient-scoped advisory lock; real-PG concurrency verifies
          // the public busy/claimed result rather than this SQL spelling.
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          // Stryker disable next-line StringLiteral:
          // @equivalent A different key changes lock granularity, not delivery semantics.
          [`alert-delivery:${input.alertEventId}:${recipientKey}`],
        );
        const state = await client.query<{
          attempt: number;
          claim_token: string | null;
          lease_expires_at: Date | null;
          phase: "claimed" | "failed" | "pending" | "succeeded";
        }>(
          `SELECT attempt, phase, lease_expires_at, claim_token
           FROM alert_notification_delivery
           WHERE alert_event_id = $1 AND recipient_key = $2
           ORDER BY occurred_at DESC, id DESC`,
          [input.alertEventId, recipientKey],
        );
        if (state.rows.some(({ phase }) => phase === "succeeded")) {
          return { status: "already_succeeded" };
        }
        const liveClaim = state.rows.find(
          ({ attempt, lease_expires_at }) =>
            lease_expires_at !== null &&
            lease_expires_at.getTime() > input.at.getTime() &&
            !state.rows.some(
              (terminal) =>
                terminal.attempt === attempt &&
                (terminal.phase === "failed" ||
                  // Stryker disable next-line ConditionalExpression,StringLiteral:
                  // @equivalent Any succeeded row returns already_succeeded
                  // above, before live-claim evaluation.
                  terminal.phase === "succeeded"),
            ),
        );
        if (liveClaim) return { status: "busy" };
        // The append-only journal can contain non-pending rows only after its pending origin.
        if (state.rows.length === 0) {
          throw new Error("alert delivery has no pending outbox record");
        }
        const claimed = await client.query<{
          attempt: number;
          claim_token: string;
        }>(
          `SELECT attempt, claim_token
           FROM claim_alert_recipient_delivery($1, $2, $3, $4, $5)`,
          [
            input.alertEventId,
            recipientKey,
            input.at,
            new Date(input.at.getTime() + input.leaseMs),
            input.workerId,
          ],
        );
        return {
          attempt: claimed.rows[0]!.attempt,
          claimToken: claimed.rows[0]!.claim_token,
          status: "claimed",
        };
      });
    },

    close: async () => {
      await pool.end();
    },

    async completeFailure(input) {
      assertCompletion(input);
      await pool.query(
        `SELECT complete_alert_recipient_delivery(
           $1, $2, $3, $4, $5, 'failed', NULL, NULL, $6
         )`,
        [
          input.alertEventId,
          input.recipientKey ?? "default",
          input.attempt,
          input.claimToken,
          input.at,
          input.errorCode,
        ],
      );
    },

    async completeSuccess(input) {
      assertCompletion(input);
      if (!input.providerMessageId.trim()) {
        throw new TypeError("providerMessageId is required");
      }
      await pool.query(
        `SELECT complete_alert_recipient_delivery(
           $1, $2, $3, $4, $5, 'succeeded', $6, $7::jsonb, NULL
         )`,
        [
          input.alertEventId,
          input.recipientKey ?? "default",
          input.attempt,
          input.claimToken,
          input.at,
          input.providerMessageId,
          JSON.stringify(input.accepted),
        ],
      );
    },

    async enqueue(input) {
      assertDate(input.firedAt, "firedAt");
      for (const delivery of input.deliveries ?? []) {
        if (!delivery.key.trim() || !delivery.email.trim()) {
          throw new TypeError("recipient delivery identity is required");
        }
      }
      try {
        return await inTransaction(pool, async (client) => {
          const created = await client.query<{ id: string }>(
            `INSERT INTO alert_event
             (alert_rule_id, fired_at, subject_ref, notified, dedupe_key)
             VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
             RETURNING id`,
            [
              input.alertRuleId,
              input.firedAt,
              JSON.stringify(input.subjectRef),
              JSON.stringify(input.notified ?? { status: "pending" }),
              input.dedupeKey,
            ],
          );
          const event = created.rows[0]!;
          if (input.deliveries === undefined) {
            await client.query(
              "SELECT append_alert_delivery_pending($1, $2)",
              [event.id, input.firedAt],
            );
          } else {
            for (const delivery of input.deliveries) {
              await client.query(
                `SELECT append_alert_recipient_pending(
                   $1, $2, $3, $4, $5, $6
                 )`,
                [
                  event.id,
                  delivery.key,
                  delivery.userAccountId,
                  delivery.email,
                  delivery.locale,
                  input.firedAt,
                ],
              );
            }
          }
          return { id: event.id, status: "created" as const };
        });
      } catch (error) {
        if (!isDedupeKeyViolation(error)) throw error;
        const replay = await pool.query<{ id: string }>(
          "SELECT id FROM alert_event WHERE dedupe_key = $1",
          [input.dedupeKey],
        );
        // The named unique violation can only come from a committed row with this key.
        const replayEvent = replay.rows[0]!;
        return {
          id: replayEvent.id,
          postgresCode: "23505",
          status: "replayed",
        };
      }
    },

    async listRecipients(alertEventId) {
      const result = await pool.query<{
        recipient_email: string;
        recipient_key: string;
        recipient_locale: "en" | "es" | null;
        recipient_user_account_id: string | null;
      }>(
        `SELECT recipient_key, recipient_user_account_id, recipient_email,
                recipient_locale::text
         FROM alert_notification_delivery
         WHERE alert_event_id = $1
           AND phase = 'pending'
           AND recipient_email IS NOT NULL
         ORDER BY recipient_key`,
        [alertEventId],
      );
      return result.rows.map((row) => ({
        email: row.recipient_email,
        key: row.recipient_key,
        locale: row.recipient_locale ?? "es",
        userAccountId: row.recipient_user_account_id,
      }));
    },

    async listReadyEventIds(at) {
      assertDate(at, "at");
      const result = await pool.query<{ id: string }>(
        `SELECT event.id
         FROM alert_event event
         WHERE EXISTS (
           SELECT 1
           FROM alert_notification_delivery pending
           WHERE pending.alert_event_id = event.id
             AND pending.phase = 'pending'
             AND NOT EXISTS (
               SELECT 1
               FROM alert_notification_delivery terminal
               WHERE terminal.alert_event_id = pending.alert_event_id
                 AND terminal.recipient_key = pending.recipient_key
                 AND terminal.phase = 'succeeded'
             )
             AND NOT EXISTS (
               SELECT 1
               FROM alert_notification_delivery claim
               WHERE claim.alert_event_id = pending.alert_event_id
                 AND claim.recipient_key = pending.recipient_key
                 AND claim.phase = 'claimed'
                 AND claim.lease_expires_at > $1
                 AND NOT EXISTS (
                   SELECT 1
                   FROM alert_notification_delivery terminal
                   WHERE terminal.alert_event_id = claim.alert_event_id
                     AND terminal.recipient_key = claim.recipient_key
                     AND terminal.attempt = claim.attempt
                     AND terminal.phase IN ('succeeded', 'failed')
                 )
             )
           )
         ORDER BY event.fired_at, event.id`,
        [at],
      );
      return result.rows.map(({ id }) => id);
    },
  };
}

async function inTransaction<T>(
  pool: pg.Pool,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function assertDate(value: Date, name: string): void {
  if (!Number.isFinite(value.getTime())) throw new TypeError(`${name} must be a valid date`);
}

function assertCompletion(input: {
  alertEventId: string;
  at: Date;
  attempt: number;
  claimToken: string;
  recipientKey?: string;
  workerId: string;
}): void {
  assertDate(input.at, "at");
  if (
    !input.alertEventId.trim() ||
    !input.claimToken.trim() ||
    !(input.recipientKey ?? "default").trim() ||
    !input.workerId.trim()
  ) {
    throw new TypeError("delivery identity is required");
  }
  if (!Number.isInteger(input.attempt) || input.attempt <= 0) {
    throw new RangeError("attempt must be a positive integer");
  }
}

function isUniqueViolation(error: unknown): error is { code: "23505" } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function isDedupeKeyViolation(
  error: unknown,
): error is { code: "23505"; constraint: "uq_alert_event_dedupe_key" } {
  return (
    isUniqueViolation(error) &&
    "constraint" in error &&
    error.constraint === "uq_alert_event_dedupe_key"
  );
}
