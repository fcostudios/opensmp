import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import type { LedgerAuthorization } from "../identity-access/authorization";
import type {
  Database,
  RequestActionKind,
  RequestActionMode,
  RequestActionStatus,
  RequestAssignmentEndReason,
  RequestState,
  RequestWarning,
} from "./repository";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface RequestListItem {
  readonly id: string;
  readonly requestNo: string;
  readonly personName: string;
  readonly companyName: string;
  readonly vendorAccountName: string;
  readonly licenseTypeName: string;
  readonly state: RequestState;
  readonly submittedAt: string;
  readonly decidedAt: string | null;
  readonly neededBy: string | null;
}

export interface BlockedExceptionItem {
  readonly blockedAt: string;
  readonly companyName: string;
  readonly daysBlocked: number;
  readonly id: string;
  readonly licenseTypeName: string;
  readonly neededBy: string | null;
  readonly personName: string;
  readonly requestNo: string;
  readonly status: "blocked_no_seat";
  readonly vendorAccountName: string;
}

export interface BlockedExceptionPage {
  readonly items: readonly BlockedExceptionItem[];
  readonly nextCursor: string | null;
}

export interface OperationalExceptionCounts {
  readonly blocked: bigint;
  readonly failed: bigint;
}

function parseBlockedCursor(cursor: string | null | undefined) {
  if (!cursor) return null;
  const separator = cursor.lastIndexOf("|");
  const blockedAt = new Date(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  // Stryker disable next-line ConditionalExpression,EqualityOperator:
  // @equivalent Separator zero already produces an invalid date, so the
  // remaining validators reject it regardless of this redundant guard.
  return separator > 0 &&
    Number.isFinite(blockedAt.getTime()) &&
    z.string().uuid().safeParse(id).success
    ? { blockedAt, id }
    : null;
}

export interface RequestTimelineItem {
  readonly id: string;
  readonly from: string | null;
  readonly to: string;
  readonly actor: string | null;
  readonly note: string | null;
  readonly occurredAt: string;
}

export interface RequestActionProjection {
  readonly id: string;
  readonly kind: RequestActionKind;
  readonly mode: RequestActionMode;
  readonly status: RequestActionStatus;
  readonly vendorRef: string | null;
  readonly failureReason: string | null;
  readonly rawRequest: unknown | null;
  readonly rawResponse: unknown | null;
  readonly sentAt: string | null;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
}

export interface RequestAssignmentProjection {
  readonly id: string;
  readonly startedOn: string;
  readonly endedOn: string | null;
  readonly endReason: RequestAssignmentEndReason;
  readonly note: string | null;
}

export interface RequestAuditProjection {
  readonly id: string;
  readonly actor: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly note: string | null;
  readonly occurredAt: string;
}

export interface RequestRecordProjection {
  readonly id: string;
  readonly requestNo: string;
  readonly state: RequestState;
  readonly stateAgeDays: number;
  readonly justification: string;
  readonly neededBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string | null;
  readonly decidedAt: string | null;
  readonly decisionComment: string | null;
  readonly requestedBy: string | null;
  readonly decidedBy: string | null;
  readonly person: {
    readonly id: string;
    readonly fullName: string;
    readonly email: string;
  };
  readonly company: {
    readonly id: string;
    readonly name: string;
    readonly code: string;
  };
  readonly vendorAccount: {
    readonly id: string;
    readonly name: string;
  };
  readonly licenseType: {
    readonly id: string;
    readonly name: string;
  };
  readonly warnings: readonly RequestWarning[];
  readonly timeline: readonly RequestTimelineItem[];
  readonly actions: readonly RequestActionProjection[];
  readonly assignment: RequestAssignmentProjection | null;
  readonly audit: readonly RequestAuditProjection[];
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

/** Whole elapsed 24-hour periods, clamped against a future/corrupt transition. */
export function currentStateAgeDays(
  now: Date,
  latestTransitionAt: Date | string | null,
): number {
  if (latestTransitionAt === null) return 0;
  return Math.max(
    0,
    Math.floor((now.getTime() - new Date(latestTransitionAt).getTime()) / 86_400_000),
  );
}

function readScope(
  authorization: LedgerAuthorization,
  requestAlias = sql.raw("lr"),
): SQL {
  const approverCompanyIds = authorization.companyGrants
    .filter(({ role }) => role === "approver")
    .map(({ companyId }) => companyId);
  const approverScope =
    approverCompanyIds.length === 0
      ? sql`FALSE`
      : sql`${requestAlias}.company_id IN (${sql.join(
          approverCompanyIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  return sql`(
    ${authorization.globalRole === "group_admin"}
    OR EXISTS (
      SELECT 1
      FROM user_account scope_actor
      WHERE scope_actor.id = ${authorization.userAccountId}::uuid
        AND scope_actor.status = 'active'
        AND scope_actor.person_id = ${requestAlias}.person_id
    )
    OR ${approverScope}
  )`;
}

export function createRequestReadRepository(
  database: Database,
  clock: () => Date,
  hooks: {
    readonly afterBaseRead?: (transaction: Transaction) => Promise<void>;
  } = {},
) {
  return {
    async countOperationalExceptions(
      authorization: LedgerAuthorization,
    ): Promise<OperationalExceptionCounts> {
      const result = await database.execute<{
        readonly blocked: string;
        readonly failed: string;
      }>(
        sql`SELECT (
              SELECT count(*)::text
              FROM license_request count_request
              WHERE count_request.state = 'blocked_no_seat'
                AND ${readScope(authorization, sql.raw("count_request"))}
            ) AS blocked,
            (
              SELECT count(*)::text
              FROM provisioning_action count_action
              JOIN license_request count_failed_request
                ON count_failed_request.id = count_action.request_id
              JOIN person count_holder
                ON count_holder.id = count_failed_request.person_id
               AND count_holder.company_id = count_failed_request.company_id
              WHERE count_action.kind = 'checklist'
                AND count_action.mode = 'orchestration'
                AND count_action.status IN ('failed', 'verification_failed')
                AND count_action.failure_reason IS NOT NULL
                AND ${readScope(
                  authorization,
                  sql.raw("count_failed_request"),
                )}
            ) AS failed`,
      );
      const [row] = result.rows;
      return {
        blocked: BigInt(row!.blocked),
        failed: BigInt(row!.failed),
      };
    },

    async listBlockedExceptions(
      authorization: LedgerAuthorization,
      options: { readonly cursor?: string | null; readonly limit?: number } = {},
    ): Promise<BlockedExceptionPage> {
      const cursor = parseBlockedCursor(options.cursor);
      const limit = Math.min(
        100,
        Math.max(1, Math.trunc(options.limit ?? 50)),
      );
      const result = await database.execute<{
        readonly blockedAt: Date | string;
        readonly companyName: string;
        readonly id: string;
        readonly licenseTypeName: string;
        readonly neededBy: string | null;
        readonly personName: string;
        readonly requestNo: string;
        readonly status: "blocked_no_seat";
        readonly vendorAccountName: string;
      }>(
        sql`SELECT lr.id::text AS id,
                   lr.request_no AS "requestNo",
                   p.full_name AS "personName",
                   c.name AS "companyName",
                   va.name AS "vendorAccountName",
                   lt.name AS "licenseTypeName",
                   lr.needed_by::text AS "neededBy",
                   lr.state AS status,
                   blocked.occurred_at AS "blockedAt"
            FROM license_request lr
            JOIN person p
              ON p.id = lr.person_id
             AND p.company_id = lr.company_id
            JOIN company c ON c.id = lr.company_id
            JOIN vendor_account va ON va.id = lr.vendor_account_id
            JOIN license_type lt
              ON lt.id = lr.license_type_id
             AND lt.vendor_id = va.vendor_id
            JOIN LATERAL (
              SELECT transition.occurred_at
              FROM request_transition transition
              WHERE transition.request_id = lr.id
                AND transition.to_state = 'blocked_no_seat'
              ORDER BY transition.occurred_at DESC, transition.id DESC
              LIMIT 1
            ) blocked ON TRUE
            WHERE lr.state = 'blocked_no_seat'
              AND ${readScope(authorization)}
              AND (
                ${cursor?.blockedAt ?? null}::timestamptz IS NULL
                OR (blocked.occurred_at, lr.id) <
                   (${cursor?.blockedAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid)
              )
            ORDER BY blocked.occurred_at DESC, lr.id DESC
            LIMIT ${limit + 1}`,
      );
      const rows = result.rows.slice(0, limit);
      const items = rows.map((row) => ({
        ...row,
        blockedAt: iso(row.blockedAt),
        daysBlocked: currentStateAgeDays(clock(), row.blockedAt),
      }));
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          result.rows.length > limit && last
            ? `${last.blockedAt}|${last.id}`
            : null,
      };
    },

    async list(
      authorization: LedgerAuthorization,
    ): Promise<readonly RequestListItem[]> {
      const result = await database.execute<{
        readonly id: string;
        readonly requestNo: string;
        readonly personName: string;
        readonly companyName: string;
        readonly vendorAccountName: string;
        readonly licenseTypeName: string;
        readonly state: RequestState;
        readonly submittedAt: Date | string;
        readonly decidedAt: Date | string | null;
        readonly neededBy: string | null;
      }>(
        sql`SELECT lr.id::text AS id,
                   lr.request_no AS "requestNo",
                   p.full_name AS "personName",
                   c.name AS "companyName",
                   va.name AS "vendorAccountName",
                   lt.name AS "licenseTypeName",
                   lr.state,
                   lr.created_at AS "submittedAt",
                   lr.decided_at AS "decidedAt",
                   lr.needed_by::text AS "neededBy"
            FROM license_request lr
            JOIN person p
              ON p.id = lr.person_id
             AND p.company_id = lr.company_id
            JOIN company c
              ON c.id = lr.company_id
            JOIN vendor_account va
              ON va.id = lr.vendor_account_id
            JOIN license_type lt
              ON lt.id = lr.license_type_id
             AND lt.vendor_id = va.vendor_id
            WHERE ${readScope(authorization)}
            ORDER BY lr.created_at DESC, lr.id DESC`,
      );
      return result.rows.map((row) => ({
        ...row,
        decidedAt: nullableIso(row.decidedAt),
        submittedAt: iso(row.submittedAt),
      }));
    },

    async detail(
      authorization: LedgerAuthorization,
      requestId: string,
    ): Promise<RequestRecordProjection | null> {
      if (!z.string().uuid().safeParse(requestId).success) return null;
      return database.transaction(async (transaction) => {
        const base = await loadBase(transaction, authorization, requestId);
        if (!base) return null;
        await hooks.afterBaseRead?.(transaction);
        const timeline = await loadTimeline(transaction, requestId);
        const actions = await loadActions(
          transaction,
          requestId,
          authorization.globalRole === "group_admin",
        );
        const assignment = await loadAssignment(
          transaction,
          requestId,
          base.companyId,
          base.personId,
        );
        const audit =
          authorization.globalRole === "group_admin"
            ? await loadAudit(transaction, requestId, base.companyId)
            : [];
        const latestTransition = timeline.at(-1)?.occurredAt ?? null;
        return {
          id: base.id,
          requestNo: base.requestNo,
          state: base.state,
          stateAgeDays: currentStateAgeDays(clock(), latestTransition),
          justification: base.justification,
          neededBy: base.neededBy,
          createdAt: iso(base.createdAt),
          updatedAt: nullableIso(base.updatedAt),
          decidedAt: nullableIso(base.decidedAt),
          decisionComment: base.decisionComment,
          requestedBy: base.requestedBy,
          decidedBy: base.decidedBy,
          person: {
            id: base.personId,
            fullName: base.personName,
            email: base.personEmail,
          },
          company: {
            id: base.companyId,
            name: base.companyName,
            code: base.companyCode,
          },
          vendorAccount: {
            id: base.vendorAccountId,
            name: base.vendorAccountName,
          },
          licenseType: {
            id: base.licenseTypeId,
            name: base.licenseTypeName,
          },
          warnings: base.warnings,
          timeline,
          actions,
          assignment,
          audit,
        };
      }, {
        accessMode: "read only",
        isolationLevel: "repeatable read",
      });
    },
  };
}

async function loadBase(
  transaction: Transaction,
  authorization: LedgerAuthorization,
  requestId: string,
) {
  const result = await transaction.execute<{
    readonly id: string;
    readonly requestNo: string;
    readonly state: RequestState;
    readonly justification: string;
    readonly neededBy: string | null;
    readonly createdAt: Date | string;
    readonly updatedAt: Date | string | null;
    readonly decidedAt: Date | string | null;
    readonly decisionComment: string | null;
    readonly requestedBy: string | null;
    readonly decidedBy: string | null;
    readonly personId: string;
    readonly personName: string;
    readonly personEmail: string;
    readonly companyId: string;
    readonly companyName: string;
    readonly companyCode: string;
    readonly vendorAccountId: string;
    readonly vendorAccountName: string;
    readonly licenseTypeId: string;
    readonly licenseTypeName: string;
    readonly warnings: RequestWarning[];
  }>(
    sql`SELECT lr.id::text AS id,
               lr.request_no AS "requestNo",
               lr.state,
               lr.justification,
               lr.needed_by::text AS "neededBy",
               lr.created_at AS "createdAt",
               lr.updated_at AS "updatedAt",
               lr.decided_at AS "decidedAt",
               lr.decision_comment AS "decisionComment",
               COALESCE(requester_person.full_name, requester.email) AS "requestedBy",
               COALESCE(decider_person.full_name, decider.email) AS "decidedBy",
               p.id::text AS "personId",
               p.full_name AS "personName",
               p.email AS "personEmail",
               c.id::text AS "companyId",
               c.name AS "companyName",
               c.code AS "companyCode",
               va.id::text AS "vendorAccountId",
               va.name AS "vendorAccountName",
               lt.id::text AS "licenseTypeId",
               lt.name AS "licenseTypeName",
               COALESCE(submitted.after->'warnings', '[]'::jsonb) AS warnings
        FROM license_request lr
        JOIN person p
          ON p.id = lr.person_id
         AND p.company_id = lr.company_id
        JOIN company c
          ON c.id = lr.company_id
        JOIN vendor_account va
          ON va.id = lr.vendor_account_id
        JOIN license_type lt
          ON lt.id = lr.license_type_id
         AND lt.vendor_id = va.vendor_id
        LEFT JOIN user_account requester
          ON requester.id = lr.requested_by
        LEFT JOIN person requester_person
          ON requester_person.id = requester.person_id
        LEFT JOIN user_account decider
          ON decider.id = lr.decided_by
        LEFT JOIN person decider_person
          ON decider_person.id = decider.person_id
        LEFT JOIN LATERAL (
          SELECT al.after
          FROM audit_log al
          WHERE al.company_id = lr.company_id
            AND al.entity_type = 'LicenseRequest'
            AND al.entity_id = lr.id
            AND al.action = 'request.submitted'
          ORDER BY al.occurred_at, al.id
          LIMIT 1
        ) submitted ON TRUE
        WHERE lr.id = ${requestId}::uuid
          AND ${readScope(authorization)}
        LIMIT 1`,
  );
  return result.rows[0] ?? null;
}

async function loadTimeline(
  transaction: Transaction,
  requestId: string,
): Promise<readonly RequestTimelineItem[]> {
  const result = await transaction.execute<{
    readonly id: string;
    readonly from: string | null;
    readonly to: string;
    readonly actor: string | null;
    readonly note: string | null;
    readonly occurredAt: Date | string;
  }>(
    sql`SELECT rt.id::text AS id,
               rt.from_state AS "from",
               rt.to_state AS "to",
               COALESCE(actor_person.full_name, actor.email) AS actor,
               rt.note,
               rt.occurred_at AS "occurredAt"
        FROM request_transition rt
        LEFT JOIN user_account actor
          ON actor.id = rt.actor_user_id
        LEFT JOIN person actor_person
          ON actor_person.id = actor.person_id
        WHERE rt.request_id = ${requestId}::uuid
        ORDER BY rt.occurred_at, rt.id`,
  );
  return result.rows.map((row) => ({
    ...row,
    occurredAt: iso(row.occurredAt),
  }));
}

async function loadActions(
  transaction: Transaction,
  requestId: string,
  includePayload: boolean,
): Promise<readonly RequestActionProjection[]> {
  const result = await transaction.execute<{
    readonly id: string;
    readonly kind: RequestActionKind;
    readonly mode: RequestActionMode;
    readonly status: RequestActionStatus;
    readonly vendorRef: string | null;
    readonly failureReason: string | null;
    readonly rawRequest: unknown;
    readonly rawResponse: unknown;
    readonly sentAt: Date | string | null;
    readonly resolvedAt: Date | string | null;
    readonly createdAt: Date | string;
  }>(
    sql`SELECT pa.id::text AS id,
               pa.kind,
               pa.mode,
               pa.status,
               pa.vendor_ref AS "vendorRef",
               pa.failure_reason AS "failureReason",
               CASE WHEN ${includePayload}
                 THEN pa.raw_request ELSE NULL
               END AS "rawRequest",
               CASE WHEN ${includePayload}
                 THEN pa.raw_response ELSE NULL
               END AS "rawResponse",
               pa.sent_at AS "sentAt",
               pa.resolved_at AS "resolvedAt",
               pa.created_at AS "createdAt"
        FROM provisioning_action pa
        JOIN license_request action_request
          ON action_request.id = pa.request_id
         AND action_request.vendor_account_id = pa.vendor_account_id
        WHERE pa.request_id = ${requestId}::uuid
        ORDER BY pa.created_at, pa.id`,
  );
  return result.rows.map((row) => ({
    ...row,
    createdAt: iso(row.createdAt),
    resolvedAt: nullableIso(row.resolvedAt),
    sentAt: nullableIso(row.sentAt),
  }));
}

async function loadAssignment(
  transaction: Transaction,
  requestId: string,
  companyId: string,
  personId: string,
): Promise<RequestAssignmentProjection | null> {
  const result = await transaction.execute<{
    readonly id: string;
    readonly startedOn: string;
    readonly endedOn: string | null;
    readonly endReason: RequestAssignmentProjection["endReason"];
    readonly note: string | null;
  }>(
    sql`SELECT la.id::text AS id,
               la.started_on::text AS "startedOn",
               la.ended_on::text AS "endedOn",
               la.end_reason AS "endReason",
               la.note
        FROM license_assignment la
        WHERE la.source_request_id = ${requestId}::uuid
          AND la.company_id = ${companyId}::uuid
          AND la.person_id = ${personId}::uuid
        ORDER BY la.started_on DESC, la.id DESC
        LIMIT 1`,
  );
  return result.rows[0] ?? null;
}

async function loadAudit(
  transaction: Transaction,
  requestId: string,
  companyId: string,
): Promise<readonly RequestAuditProjection[]> {
  const result = await transaction.execute<{
    readonly id: string;
    readonly actor: string | null;
    readonly action: string;
    readonly entityType: string;
    readonly note: string | null;
    readonly occurredAt: Date | string;
  }>(
    sql`SELECT al.id::text AS id,
               COALESCE(actor_person.full_name, actor.email) AS actor,
               al.action,
               al.entity_type AS "entityType",
               al.note,
               al.occurred_at AS "occurredAt"
        FROM audit_log al
        LEFT JOIN user_account actor
          ON actor.id = al.actor_user_id
        LEFT JOIN person actor_person
          ON actor_person.id = actor.person_id
        WHERE al.company_id = ${companyId}::uuid
          AND (
            (al.entity_type = 'LicenseRequest'
              AND al.entity_id = ${requestId}::uuid)
            OR (
              al.entity_type = 'ProvisioningAction'
              AND EXISTS (
                SELECT 1
                FROM provisioning_action pa
                JOIN license_request lr
                  ON lr.id = pa.request_id
                 AND lr.company_id = ${companyId}::uuid
                WHERE pa.id = al.entity_id
                  AND pa.request_id = ${requestId}::uuid
              )
            )
            OR (
              al.entity_type = 'LicenseAssignment'
              AND EXISTS (
                SELECT 1
                FROM license_assignment la
                WHERE la.id = al.entity_id
                  AND la.company_id = ${companyId}::uuid
                  AND la.source_request_id = ${requestId}::uuid
              )
            )
          )
        ORDER BY al.occurred_at, al.id`,
  );
  return result.rows.map((row) => ({
    ...row,
    occurredAt: iso(row.occurredAt),
  }));
}

export type RequestReadRepository = ReturnType<
  typeof createRequestReadRepository
>;
