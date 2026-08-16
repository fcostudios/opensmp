import {
  createAlertNotificationOutbox,
  type AlertEventInput,
} from "@smp/notifications/outbox";
import pg from "pg";

import {
  buildAlertScopeClause,
  countAuthorizedAlertEvents,
  listAuthorizedAlertEvents,
  type AlertEventCounts,
  type AlertEventPage,
  type AlertReadOptions,
} from "../operational-alert-read";
import type { LedgerAuthorization } from "../identity-access/authorization";

export type { AlertEventInput };
export {
  parseAlertCursor,
  serializeAlertCursor,
  type AlertEventPage,
  type AlertReadFilter,
  type AlertReadOptions,
  type CompanyAlertEvent,
} from "../operational-alert-read";

export type AlertRepository = {
  close(): Promise<void>;
  createEvent(input: AlertEventInput): Promise<
    | { id: string; status: "created" }
    | { id: string; status: "replayed" }
  >;
  countAuthorizedEvents(
    authorization: Parameters<typeof countAuthorizedAlertEvents>[1],
  ): Promise<AlertEventCounts>;
  listAuthorizedEvents(
    authorization: Parameters<typeof listAuthorizedAlertEvents>[1],
    options?: AlertReadOptions,
  ): Promise<AlertEventPage>;
  acknowledgeEvent(input: {
    readonly alertEventId: string;
    readonly actorUserAccountId: string;
    readonly authorization: LedgerAuthorization;
    readonly occurredAt: Date;
  }): Promise<
    | { readonly status: "acknowledged"; readonly acknowledgedBy: string; readonly acknowledgedAt: Date }
    | { readonly status: "already_acknowledged"; readonly acknowledgedBy: string; readonly acknowledgedAt: Date }
    | { readonly status: "not_found" }
  >;
};

export function createAlertRepository(connectionString: string): AlertRepository {
  const outbox = createAlertNotificationOutbox(connectionString);
  const pool = new pg.Pool({ connectionString });
  return {
    close: async () => {
      await Promise.all([outbox.close(), pool.end()]);
    },

    createEvent: async (input) => await outbox.enqueue(input),

    async countAuthorizedEvents(authorization) {
      return countAuthorizedAlertEvents(pool, authorization);
    },

    async listAuthorizedEvents(authorization, options = {}) {
      return listAuthorizedAlertEvents(pool, authorization, options);
    },

    async acknowledgeEvent({ alertEventId, actorUserAccountId, authorization, occurredAt }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Scope first: an out-of-scope id must be indistinguishable from a missing one.
        // Uses the same shared scope predicate as listAuthorizedAlertEvents/
        // countAuthorizedAlertEvents: global-scope alerts are only in scope for
        // group_admin authorization.
        const scope = buildAlertScopeClause(authorization, "rule", 2);
        const scoped = await client.query<{ id: string }>(
          `SELECT event.id::text AS id
           FROM alert_event event
           JOIN alert_rule rule ON rule.id = event.alert_rule_id
           WHERE event.id = $1::uuid
             AND ${scope.clause}`,
          [alertEventId, ...scope.params],
        );
        if (scoped.rows.length === 0) {
          await client.query("ROLLBACK");
          return { status: "not_found" as const };
        }

        // Only the two granted columns are written, and only while unacknowledged.
        const updated = await client.query<{ by: string; at: Date }>(
          `UPDATE alert_event
           SET acknowledged_by = $2::uuid, acknowledged_at = $3
           WHERE id = $1::uuid AND acknowledged_at IS NULL
           RETURNING acknowledged_by::text AS by, acknowledged_at AS at`,
          [alertEventId, actorUserAccountId, occurredAt],
        );

        if (updated.rows.length === 0) {
          const existing = await client.query<{ by: string; at: Date }>(
            `SELECT acknowledged_by::text AS by, acknowledged_at AS at
             FROM alert_event WHERE id = $1::uuid`,
            [alertEventId],
          );
          await client.query("COMMIT");
          return {
            status: "already_acknowledged" as const,
            acknowledgedBy: existing.rows[0]!.by,
            acknowledgedAt: existing.rows[0]!.at,
          };
        }

        await client.query(
          `INSERT INTO audit_log
             (actor_user_id, action, entity_type, entity_id, company_id, before, after, occurred_at)
           SELECT $2::uuid, 'alert.acknowledged', 'AlertEvent', event.id, rule.company_id,
                  '{"acknowledged_at":null}'::jsonb,
                  jsonb_build_object('acknowledged_by', $2::text, 'acknowledged_at', $3::text),
                  $3::timestamptz
           FROM alert_event event
           JOIN alert_rule rule ON rule.id = event.alert_rule_id
           WHERE event.id = $1::uuid`,
          [alertEventId, actorUserAccountId, occurredAt],
        );
        await client.query("COMMIT");
        return {
          status: "acknowledged" as const,
          acknowledgedBy: updated.rows[0]!.by,
          acknowledgedAt: updated.rows[0]!.at,
        };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
