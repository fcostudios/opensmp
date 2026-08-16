import pg from "pg";
import { z } from "zod";
import type { AlertEventInput } from "@smp/notifications/outbox";

import type { LedgerAuthorization } from "./identity-access/authorization";

export type CompanyAlertEvent = AlertEventInput & {
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  alertType: string;
  companyId: string | null;
  companyName: string | null;
  id: string;
  notified: unknown;
  scopeKind: string;
  subjectLinkAllowed: boolean;
};

export type AlertReadFilter = "all" | "unacknowledged";
export type AlertReadOptions = {
  readonly cursor?: string | null;
  readonly filter?: AlertReadFilter;
  readonly limit?: number;
};
export type AlertEventPage = {
  readonly items: readonly CompanyAlertEvent[];
  readonly nextCursor: string | null;
};
export type AlertEventCounts = {
  readonly all: bigint;
  readonly unacknowledged: bigint;
};

const DEFAULT_ALERT_LIMIT = 50;
const MAX_ALERT_LIMIT = 100;

export function formatOperationalBadgeCount(
  count: bigint,
  overflowLabel = "99+",
): string {
  return count > BigInt(99) ? overflowLabel : count.toString();
}

export type AlertScopeClause = {
  readonly clause: string;
  readonly params: [boolean, string[]];
};

/**
 * Builds the scope-authorization predicate shared by every query that reads
 * or mutates `alert_event` rows: global-scope alerts are in scope only for
 * `group_admin` authorization; company-scope alerts are in scope only for
 * the caller's own `companyIds`.
 *
 * `alias` is the SQL alias for the joined `alert_rule` table in the caller's
 * query. `firstPlaceholder` is the 1-based index of the first of the two
 * `$N` parameters this predicate consumes (it always consumes exactly two,
 * in order: includeGlobal, companyIds) — pass the next free placeholder
 * index for queries with preceding params (e.g. an id filter).
 */
export function buildAlertScopeClause(
  authorization: LedgerAuthorization,
  alias: string,
  firstPlaceholder: number,
): AlertScopeClause {
  const includeGlobal = authorization.globalRole === "group_admin";
  const companyIds = [...new Set(authorization.companyIds)];
  const clause = `(
              ($${firstPlaceholder}::boolean AND ${alias}.scope_kind::text = 'global')
              OR (
                ${alias}.scope_kind::text = 'company'
                AND ${alias}.company_id = ANY($${firstPlaceholder + 1}::uuid[])
              )
            )`;
  return { clause, params: [includeGlobal, companyIds] };
}

export async function countAuthorizedAlertEvents(
  pool: pg.Pool,
  authorization: LedgerAuthorization,
): Promise<AlertEventCounts> {
  const scope = buildAlertScopeClause(authorization, "count_rule", 1);
  const result = await pool.query<{
    all_count: string;
    unacknowledged_count: string;
  }>(
    `SELECT count(*)::text AS all_count,
            count(*) FILTER (
              WHERE count_event.acknowledged_at IS NULL
            )::text AS unacknowledged_count
       FROM alert_event AS count_event
       INNER JOIN alert_rule AS count_rule
         ON count_rule.id = count_event.alert_rule_id
      WHERE ${scope.clause}`,
    scope.params,
  );
  const [row] = result.rows;
  return {
    all: BigInt(row!.all_count),
    unacknowledged: BigInt(row!.unacknowledged_count),
  };
}

export function parseAlertCursor(
  cursor: string | null | undefined,
): { readonly firedAt: Date; readonly id: string } | null {
  if (!cursor) return null;
  const separator = cursor.lastIndexOf("|");
  if (separator < 1) return null;
  const firedAt = new Date(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  return Number.isFinite(firedAt.getTime()) &&
    z.string().uuid().safeParse(id).success
    ? { firedAt, id }
    : null;
}

export function serializeAlertCursor(event: {
  readonly firedAt: Date;
  readonly id: string;
}): string {
  return `${event.firedAt.toISOString()}|${event.id}`;
}

type EventRow = {
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  alert_rule_id: string;
  alert_type: string;
  company_id: string | null;
  company_name: string | null;
  dedupe_key: string;
  fired_at: Date;
  id: string;
  notified: unknown;
  scope_kind: string;
  subject_ref: Record<string, string>;
  subject_link_allowed: boolean;
};

export async function listAuthorizedAlertEvents(
  pool: pg.Pool,
  authorization: LedgerAuthorization,
  options: AlertReadOptions,
): Promise<AlertEventPage> {
  const cursor = parseAlertCursor(options.cursor);
  const limit = Math.min(
    MAX_ALERT_LIMIT,
    Math.max(1, Math.trunc(options.limit ?? DEFAULT_ALERT_LIMIT)),
  );
  const scope = buildAlertScopeClause(authorization, "rule", 1);
  const result = await pool.query<EventRow>(
    `SELECT event.id, event.alert_rule_id, event.fired_at,
                event.subject_ref,
                event.acknowledged_at,
                actor.email AS acknowledged_by,
                rule.type::text AS alert_type,
                rule.scope_kind::text AS scope_kind,
                COALESCE(
                  rule.company_id,
                  request_target.company_id
                )::text AS company_id,
                COALESCE(tenant.name, request_target.name) AS company_name,
                CASE
                  WHEN rule.scope_kind::text = 'global'
                    AND rule.type::text IN (
                      'approval_aging',
                      'provisioning_failure',
                      'blocked_no_seat',
                      'invite_unaccepted',
                      'deprovision_overdue'
                    )
                  THEN request_target.company_id IS NOT NULL
                  ELSE TRUE
                END AS subject_link_allowed,
                COALESCE(
                  (
                    SELECT CASE
                      WHEN count(*) = 1 THEN jsonb_build_object(
                        'status', 'sent',
                        'providerMessageId',
                          (array_agg(delivery.provider_message_id))[1],
                        'accepted', (jsonb_agg(delivery.accepted)->0)
                      )
                      ELSE jsonb_build_object(
                        'status', 'sent',
                        'deliveries', jsonb_agg(
                          jsonb_build_object(
                            'recipientKey', delivery.recipient_key,
                            'providerMessageId',
                              delivery.provider_message_id,
                            'accepted', delivery.accepted
                          )
                          ORDER BY delivery.recipient_key
                        )
                      )
                    END
                    FROM alert_notification_delivery delivery
                    WHERE delivery.alert_event_id = event.id
                      AND delivery.phase = 'succeeded'
                    HAVING count(*) > 0
                  ),
                  event.notified
                ) AS notified,
                event.dedupe_key
         FROM alert_event AS event
         INNER JOIN alert_rule AS rule ON rule.id = event.alert_rule_id
         LEFT JOIN company tenant ON tenant.id = rule.company_id
         LEFT JOIN LATERAL (
           SELECT request.company_id, request_company.name
           FROM license_request request
           JOIN company request_company ON request_company.id = request.company_id
           WHERE request.id::text = event.subject_ref->>'requestId'
           LIMIT 1
         ) request_target ON rule.scope_kind::text = 'global'
         LEFT JOIN user_account actor ON actor.id = event.acknowledged_by
         WHERE ${scope.clause}
           AND (NOT $3::boolean OR event.acknowledged_at IS NULL)
           AND (
             $4::timestamptz IS NULL
             OR (event.fired_at, event.id) < ($4::timestamptz, $5::uuid)
           )
         ORDER BY event.fired_at DESC, event.id DESC
         LIMIT $6`,
    [
      ...scope.params,
      (options.filter ?? "unacknowledged") === "unacknowledged",
      cursor?.firedAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    ],
  );
  const rows = result.rows.slice(0, limit);
  const items = rows.map((row) => ({
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
    alertRuleId: row.alert_rule_id,
    alertType: row.alert_type,
    companyId: row.company_id,
    companyName: row.company_name,
    dedupeKey: row.dedupe_key,
    firedAt: row.fired_at,
    id: row.id,
    notified: row.notified,
    scopeKind: row.scope_kind,
    subjectRef: row.subject_ref,
    subjectLinkAllowed: row.subject_link_allowed,
  }));
  return {
    items,
    nextCursor:
      result.rows.length > limit && items.length > 0
        ? serializeAlertCursor(items.at(-1)!)
        : null,
  };
}
