import { randomUUID } from "node:crypto";

import {
  createConnectorDispatcher,
  planProvisioningAction,
  type ConnectorDispatcher,
  type ConnectorProtocol,
  type ProvisioningActionPlan,
} from "@smp/connectors";
// eslint-disable-next-line no-restricted-imports -- This module is the atomic orchestration checklist transaction service.
import * as schema from "@smp/db/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import { z } from "zod";

import type { LedgerAuthorization } from "../identity-access/authorization";
import { observeNoSeatInTransaction } from "../vendor-catalog/no-seat-observation";
import { checklistAssignmentMissingFailureReason } from "./checklist-failure-reason";
import {
  parseChecklistPayload,
  parseConfirmChecklist,
  parseFailChecklist,
  parseObservation,
  safeParseChecklistPayload,
  validatedChecklistSteps,
} from "./orchestration-contract";
import {
  applyLockedRequestTransition,
  type LedgerTransaction,
} from "./transition-core";

type RouteWire = {
  accountMode: "automated" | "orchestration";
  canProvision: boolean;
  companyId: string;
  licenseTypeId: string;
  licenseTypeName: string;
  personEmail: string;
  personId: string;
  protocol: ConnectorProtocol;
  requestId: string;
  requestState: string;
  vendorAccountId: string;
};

type ExistingActionWire = {
  id: string;
  kind: "checklist" | "invite";
  mode: "automated" | "orchestration";
  rawRequest: unknown;
  status: "pending" | "sent" | "confirmed" | "failed" | "verification_failed";
};

export function validateAutomatedProvisionPayload(value: unknown): void {
  z.object({
    checklistSteps: z.tuple([]),
    context: z.object({
      companyId: z.string().uuid(),
      requestId: z.string().uuid(),
    }).strict(),
    instruction: z.object({
      licenseTypeName: z.string().trim().min(1),
      personEmail: z.string().email(),
      requestId: z.string().uuid(),
      vendorAccountId: z.string().uuid(),
    }).strict(),
    operation: z.literal("provision"),
    protocol: z.enum(["rest", "scim"]),
    version: z.literal(1),
  }).strict().parse(value);
}

type TransactionalDatabase = Pick<
  NodePgDatabase<typeof schema>,
  "execute" | "transaction"
>;

function assertGroupAdmin(authorization: LedgerAuthorization): void {
  if (authorization.globalRole !== "group_admin") {
    throw new Error("CHECKLIST_FORBIDDEN");
  }
}

function ecuadorCalendarDate(value: Date): string {
  return new Date(value.getTime() - 18_000_000).toISOString().slice(0, 10);
}

export function validateProvisioningActionPlan(
  plan: ProvisioningActionPlan,
): void {
  if (plan.kind === "checklist" && plan.mode === "orchestration") {
    parseChecklistPayload(plan.rawRequest);
    return;
  }
  if (plan.kind === "invite" && plan.mode === "automated") {
    validateAutomatedProvisionPayload(plan.rawRequest);
    return;
  }
  throw new Error("PROVISIONING_ACTION_PLAN_INVALID");
}

export async function routeApprovedRequestInTransaction(
  transaction: LedgerTransaction,
  authorization: LedgerAuthorization,
  requestId: string,
  occurredAt: Date,
  dispatcher: ConnectorDispatcher = createConnectorDispatcher(),
) {
  const routed = await transaction.execute<RouteWire>(
    sql`SELECT request.id::text AS "requestId",
               request.state::text AS "requestState",
               request.company_id::text AS "companyId",
               request.person_id::text AS "personId",
               request.vendor_account_id::text AS "vendorAccountId",
               request.license_type_id::text AS "licenseTypeId",
               holder.email AS "personEmail",
               license.name AS "licenseTypeName",
               account.mode::text AS "accountMode",
               vendor.provisioning_protocol::text AS protocol,
               vendor.can_provision AS "canProvision"
        FROM license_request request
        JOIN person holder
          ON holder.id = request.person_id
         AND holder.company_id = request.company_id
        JOIN company tenant ON tenant.id = request.company_id
        JOIN vendor_account account
          ON account.id = request.vendor_account_id
         AND account.status = 'active'
        JOIN vendor ON vendor.id = account.vendor_id
        JOIN license_type license
          ON license.id = request.license_type_id
         AND license.vendor_id = vendor.id
         AND license.status = 'active'
        WHERE request.id = ${requestId}::uuid
        FOR UPDATE OF request`,
  );
  const [request] = routed.rows;
  if (!request) throw new Error("CHECKLIST_REQUEST_NOT_FOUND");

  const existingResult = await transaction.execute<ExistingActionWire>(
    sql`SELECT id::text, kind::text, mode::text, status::text,
               raw_request AS "rawRequest"
        FROM provisioning_action
        WHERE request_id = ${requestId}::uuid
          AND raw_request->>'operation' = 'provision'
          AND (
            (kind = 'checklist' AND mode = 'orchestration')
            OR (kind = 'invite' AND mode = 'automated')
          )
        ORDER BY created_at, id
        FOR UPDATE`,
  );
  const [existing] = existingResult.rows;
  if (existing) {
    if (existing.kind === "checklist") {
      validatedChecklistSteps(existing.rawRequest);
    } else {
      validateAutomatedProvisionPayload(existing.rawRequest);
    }
    if (
      request.requestState !== "provisioning" &&
      request.requestState !== "active" &&
      request.requestState !== "failed"
    ) {
      throw new Error("CHECKLIST_REPLAY_STATE_CONFLICT");
    }
    return existing;
  }
  if (request.requestState !== "approved") {
    throw new Error("CHECKLIST_REQUEST_NOT_APPROVED");
  }

  const availability = await transaction.execute<{ readonly free: number }>(
    sql`SELECT (
          COALESCE((
            SELECT capacity.purchased_qty
            FROM vendor_account_capacity capacity
            WHERE capacity.vendor_account_id=${request.vendorAccountId}::uuid
              AND capacity.license_type_id=${request.licenseTypeId}::uuid
              AND capacity.effective_from <= ${ecuadorCalendarDate(occurredAt)}::date
              AND capacity.created_at <= ${occurredAt}
            ORDER BY capacity.effective_from DESC,capacity.created_at DESC,capacity.id DESC
            LIMIT 1
          ),0)
          - (SELECT count(*) FROM license_assignment assignment
             JOIN person holder ON holder.id=assignment.person_id
              AND holder.company_id=assignment.company_id
             WHERE assignment.vendor_account_id=${request.vendorAccountId}::uuid
               AND assignment.license_type_id=${request.licenseTypeId}::uuid
               AND assignment.started_on <= ${ecuadorCalendarDate(occurredAt)}::date
               AND assignment.created_at <= ${occurredAt}
               AND (assignment.ended_on IS NULL OR assignment.ended_on >= ${ecuadorCalendarDate(occurredAt)}::date))
          - (SELECT count(*) FROM provisioning_action action
             JOIN license_request pending ON pending.id=action.request_id
              AND pending.vendor_account_id=action.vendor_account_id
             WHERE action.vendor_account_id=${request.vendorAccountId}::uuid
               AND pending.license_type_id=${request.licenseTypeId}::uuid
               AND action.kind='invite' AND action.mode='automated'
               AND action.status IN ('pending','sent')
               AND action.created_at <= ${occurredAt})
        )::int AS free`,
  );
  if ((availability.rows[0]?.free ?? 0) <= 0) {
    return observeNoSeatInTransaction(
      transaction,
      { requestId: request.requestId, source: "pool_empty" },
      occurredAt,
    );
  }

  const plan = await planProvisioningAction(dispatcher, {
    accountMode: request.accountMode,
    context: {
      companyId: request.companyId,
      requestId: request.requestId,
    },
    entityIds: {
      licenseId: request.licenseTypeId,
      personId: request.personId,
    },
    instruction: {
      licenseTypeName: request.licenseTypeName,
      personEmail: request.personEmail,
      requestId: request.requestId,
      vendorAccountId: request.vendorAccountId,
    },
    operation: "provision",
    protocol: request.protocol,
    vendorCapability: request.canProvision,
  });
  validateProvisioningActionPlan(plan);
  const actionId = randomUUID();
  await transaction.execute(
    sql`INSERT INTO provisioning_action
          (id, request_id, vendor_account_id, kind, mode, status,
           raw_request, created_at)
        VALUES
          (${actionId}::uuid, ${request.requestId}::uuid,
           ${request.vendorAccountId}::uuid,
           ${plan.kind}::provisioning_action_kind_enum,
           ${plan.mode}::provisioning_action_mode_enum, 'pending',
           ${JSON.stringify(plan.rawRequest)}::jsonb,
           ${occurredAt})`,
  );
  const checklist = plan.kind === "checklist";
  await applyLockedRequestTransition(transaction, authorization, {
    actorUserId: authorization.userAccountId,
    from: "approved",
    note: checklist
      ? "Orchestration checklist issued"
      : "Automated provisioning action issued",
    occurredAt,
    requestId: request.requestId,
    to: "provisioning",
  });
  await transaction.execute(
    sql`INSERT INTO audit_log
          (actor_user_id, action, entity_type, entity_id, company_id,
           before, after, occurred_at)
        VALUES
          (${authorization.userAccountId}::uuid,
           ${checklist
             ? "orchestration.checklist_issued"
             : "orchestration.automated_action_issued"},
           'ProvisioningAction',
           ${actionId}::uuid, ${request.companyId}::uuid, NULL,
           ${JSON.stringify({
             kind: plan.kind,
             mode: plan.mode,
             requestId: request.requestId,
             status: "pending",
           })}::jsonb, ${occurredAt})`,
  );
  return {
    id: actionId,
    kind: plan.kind,
    mode: plan.mode,
    rawRequest: plan.rawRequest,
    status: "pending" as const,
  };
}

export function createOrchestrationOperations(
  database: TransactionalDatabase,
  {
    dispatcher = createConnectorDispatcher(),
    now = () => new Date(),
  }: {
    readonly dispatcher?: ConnectorDispatcher;
    readonly now?: () => Date;
  } = {},
) {
  return {
    async observeProviderNoSeat(requestId: string) {
      const occurredAt = now();
      return database.transaction(async (transaction) => {
        await transaction.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`provider-no-seat:${requestId}`},0))`,
        );
        return observeNoSeatInTransaction(
          transaction,
          { requestId, source: "provider_400" },
          occurredAt,
        );
      });
    },

    async pendingChecklist(
      authorization: LedgerAuthorization,
      requestId: string,
    ) {
      assertGroupAdmin(authorization);
      if (!z.string().uuid().safeParse(requestId).success) return null;
      const result = await database.execute<{
        id: string;
        rawRequest: unknown;
        status: "pending" | "sent";
      }>(
        sql`SELECT action.id::text, action.raw_request AS "rawRequest",
                   action.status::text AS status
            FROM provisioning_action action
            JOIN license_request request
              ON request.id = action.request_id
             AND request.vendor_account_id = action.vendor_account_id
            JOIN person holder
              ON holder.id = request.person_id
             AND holder.company_id = request.company_id
            WHERE request.id = ${requestId}::uuid
              AND action.kind = 'checklist'
              AND action.mode = 'orchestration'
              AND action.status IN ('pending','sent')
            LIMIT 1`,
      );
      const [action] = result.rows;
      if (!action || !safeParseChecklistPayload(action.rawRequest).success) {
        return null;
      }
      return action;
    },

    async verificationFailures(
      authorization: LedgerAuthorization,
      options: { readonly cursor?: string | null; readonly limit?: number } = {},
    ) {
      assertGroupAdmin(authorization);
      const separator = options.cursor?.lastIndexOf("|") ?? -1;
      const cursorAt =
        // Stryker disable next-line EqualityOperator: @equivalent Separator
        // zero produces an invalid Date and is rejected by validCursor below.
        separator > 0
          ? new Date(options.cursor!.slice(0, separator))
          : null;
      const cursorId =
        // Stryker disable next-line EqualityOperator: @equivalent Separator
        // zero cannot produce a valid cursor because cursorAt is invalid.
        separator > 0 ? options.cursor!.slice(separator + 1) : null;
      const validCursor =
        cursorAt &&
        Number.isFinite(cursorAt.getTime()) &&
        z.string().uuid().safeParse(cursorId).success
          ? { at: cursorAt, id: cursorId! }
          : null;
      const limit = Math.min(
        100,
        Math.max(1, Math.trunc(options.limit ?? 50)),
      );
      const result = await database.execute<{
        actionId: string;
        companyName: string;
        failureReason: string;
        kind: "checklist";
        mode: "orchestration";
        personEmail: string;
        requestId: string;
        requestNo: string;
        sentAt: Date | string | null;
        sortAt: Date | string;
        status: "failed" | "verification_failed";
        vendorAccountName: string;
        vendorRef: string | null;
      }>(
        sql`SELECT action.id::text AS "actionId",
                   request.id::text AS "requestId",
                   request.request_no AS "requestNo",
                   tenant.name AS "companyName",
                   holder.email AS "personEmail",
                   account.name AS "vendorAccountName",
                   action.kind::text AS kind,
                   action.mode::text AS mode,
                   action.vendor_ref AS "vendorRef",
                   action.sent_at AS "sentAt",
                   COALESCE(action.resolved_at, action.created_at) AS "sortAt",
                   action.status::text AS status,
                   action.failure_reason AS "failureReason"
            FROM provisioning_action action
            JOIN license_request request
              ON request.id = action.request_id
             AND request.vendor_account_id = action.vendor_account_id
            JOIN person holder
              ON holder.id = request.person_id
             AND holder.company_id = request.company_id
            JOIN company tenant ON tenant.id = request.company_id
            JOIN vendor_account account
              ON account.id = request.vendor_account_id
            WHERE action.kind = 'checklist'
              AND action.mode = 'orchestration'
              AND action.status IN ('failed', 'verification_failed')
              AND action.failure_reason IS NOT NULL
              AND (
                ${validCursor?.at ?? null}::timestamptz IS NULL
                OR (COALESCE(action.resolved_at, action.created_at), action.id) <
                   (${validCursor?.at ?? null}::timestamptz, ${validCursor?.id ?? null}::uuid)
              )
            ORDER BY COALESCE(action.resolved_at, action.created_at) DESC,
                     action.id DESC
            LIMIT ${limit + 1}`,
      );
      const rows = result.rows.slice(0, limit);
      const items = rows.map(({ sortAt: _sortAt, ...row }) => ({
        ...row,
        sentAt: row.sentAt === null ? null : new Date(row.sentAt).toISOString(),
      }));
      const last = rows.at(-1);
      return {
        items,
        nextCursor:
          result.rows.length > limit && last
            ? `${new Date(last.sortAt).toISOString()}|${last.actionId}`
            : null,
      };
    },

    async routeApprovedRequest(
      authorization: LedgerAuthorization,
      requestId: string,
    ) {
      assertGroupAdmin(authorization);
      if (!z.string().uuid().safeParse(requestId).success) {
        throw new TypeError("requestId must be a UUID");
      }
      const occurredAt = now();
      return database.transaction(async (transaction) => {
        await transaction.execute(
          // Stryker disable next-line StringLiteral: @equivalent Changing the
          // stable advisory key only changes contention scope, not outcomes.
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`checklist-route:${requestId}`}, 0))`,
        );
        return routeApprovedRequestInTransaction(
          transaction,
          authorization,
          requestId,
          occurredAt,
          dispatcher,
        );
      });
    },

    async confirmChecklistDone(
      authorization: LedgerAuthorization,
      untrustedInput: unknown,
    ) {
      assertGroupAdmin(authorization);
      const input = parseConfirmChecklist(untrustedInput);
      const occurredAt = now();
      const attestedOn = ecuadorCalendarDate(occurredAt);
      return database.transaction(async (transaction) => {
        await transaction.execute(
          // Stryker disable next-line StringLiteral: @equivalent Changing the
          // stable advisory key only changes contention scope, not outcomes.
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`checklist-confirm:${input.actionId}`}, 0))`,
        );
        const replay = await transaction.execute<{
          assignmentId: string;
          confirmationId: string;
          requestId: string;
        }>(
          sql`SELECT after->>'assignmentId' AS "assignmentId",
                     after->>'confirmationId' AS "confirmationId",
                     request.id::text AS "requestId"
              FROM audit_log confirmation
              JOIN provisioning_action action
                ON action.id = confirmation.entity_id
              JOIN license_request request
                ON request.id = action.request_id
               AND request.vendor_account_id = action.vendor_account_id
              WHERE confirmation.entity_type = 'ProvisioningAction'
                AND confirmation.entity_id = ${input.actionId}::uuid
                AND confirmation.action = 'orchestration.checklist_confirmed'
              LIMIT 1`,
        );
        const [existing] = replay.rows;
        if (existing) {
          if (existing.confirmationId !== input.confirmationId) {
            throw new Error("IDEMPOTENCY_CONFLICT");
          }
          return {
            assignmentId: existing.assignmentId,
            requestId: existing.requestId,
            status: "active" as const,
          };
        }

        const locked = await transaction.execute<{
          companyId: string;
          licenseTypeId: string;
          personId: string;
          rawRequest: unknown;
          requestId: string;
          requestState: string;
          status: string;
          vendorAccountId: string;
        }>(
          sql`SELECT request.id::text AS "requestId",
                     request.company_id::text AS "companyId",
                     request.person_id::text AS "personId",
                     request.vendor_account_id::text AS "vendorAccountId",
                     request.license_type_id::text AS "licenseTypeId",
                     request.state::text AS "requestState",
                     action.status::text AS status,
                     action.raw_request AS "rawRequest"
              FROM provisioning_action action
              JOIN license_request request
                ON request.id = action.request_id
               AND request.vendor_account_id = action.vendor_account_id
              JOIN person holder
                ON holder.id = request.person_id
               AND holder.company_id = request.company_id
              WHERE action.id = ${input.actionId}::uuid
                AND action.kind = 'checklist'
                AND action.mode = 'orchestration'
              FOR UPDATE OF action, request`,
        );
        const [action] = locked.rows;
        if (
          !action ||
          !["pending", "sent"].includes(action.status) ||
          action.requestState !== "provisioning"
        ) {
          throw new Error("CHECKLIST_ACTION_NOT_PENDING");
        }
        validatedChecklistSteps(action.rawRequest);
        const assignmentId = randomUUID();
        await transaction.execute(
          sql`INSERT INTO license_assignment
                (id, person_id, company_id, vendor_account_id, license_type_id,
                 started_on, source_request_id, source_kind, note, created_at,
                 created_by)
              VALUES
                (${assignmentId}::uuid, ${action.personId}::uuid,
                 ${action.companyId}::uuid, ${action.vendorAccountId}::uuid,
                 ${action.licenseTypeId}::uuid, ${attestedOn}::date,
                 ${action.requestId}::uuid, 'request',
                 'Orchestration checklist attested', ${occurredAt},
                 ${authorization.userAccountId}::uuid)`,
        );
        await transaction.execute(
          sql`UPDATE license_request
              SET license_assignment_id = ${assignmentId}::uuid,
                  updated_at = ${occurredAt}
              WHERE id = ${action.requestId}::uuid
                AND company_id = ${action.companyId}::uuid
                AND state = 'provisioning'`,
        );
        await transaction.execute(
          sql`UPDATE provisioning_action
              SET status = 'confirmed', resolved_at = ${occurredAt}
              WHERE id = ${input.actionId}::uuid AND status IN ('pending','sent')`,
        );
        await applyLockedRequestTransition(transaction, authorization, {
          actorUserId: authorization.userAccountId,
          from: "provisioning",
          note: "Orchestration checklist attested",
          occurredAt,
          requestId: action.requestId,
          to: "active",
        });
        await transaction.execute(
          sql`INSERT INTO audit_log
                (actor_user_id, action, entity_type, entity_id, company_id,
                 before, after, occurred_at)
              VALUES
                (${authorization.userAccountId}::uuid,
                 'orchestration.checklist_confirmed', 'ProvisioningAction',
                 ${input.actionId}::uuid, ${action.companyId}::uuid,
                 ${JSON.stringify({ status: action.status })}::jsonb,
                 ${JSON.stringify({
                   assignmentId,
                   attestedOn,
                   confirmationId: input.confirmationId,
                   status: "confirmed",
                 })}::jsonb, ${occurredAt})`,
        );
        return {
          assignmentId,
          requestId: action.requestId,
          status: "active" as const,
        };
      });
    },

    async markChecklistNotDone(
      authorization: LedgerAuthorization,
      untrustedInput: unknown,
    ) {
      assertGroupAdmin(authorization);
      const parsed = parseFailChecklist(untrustedInput);
      const reason = parsed.reason.trim();
      if (!reason) throw new TypeError("FAILURE_REASON_REQUIRED");
      const occurredAt = now();
      return database.transaction(async (transaction) => {
        await transaction.execute(
          // Stryker disable next-line StringLiteral: @equivalent Changing the
          // stable advisory key only changes contention scope, not outcomes.
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`checklist-failure:${parsed.actionId}`}, 0))`,
        );
        const replay = await transaction.execute<{
          failureId: string;
          reason: string;
          requestId: string;
        }>(
          sql`SELECT after->>'failureId' AS "failureId",
                     after->>'reason' AS reason,
                     request.id::text AS "requestId"
              FROM audit_log failure
              JOIN provisioning_action action
                ON action.id = failure.entity_id
              JOIN license_request request
                ON request.id = action.request_id
               AND request.vendor_account_id = action.vendor_account_id
              WHERE failure.entity_type = 'ProvisioningAction'
                AND failure.entity_id = ${parsed.actionId}::uuid
                AND failure.action = 'orchestration.checklist_failed'
              LIMIT 1`,
        );
        const [existing] = replay.rows;
        if (existing) {
          if (existing.failureId !== parsed.failureId || existing.reason !== reason) {
            throw new Error("IDEMPOTENCY_CONFLICT");
          }
          return {
            requestId: existing.requestId,
            status: "failed" as const,
          };
        }
        const locked = await transaction.execute<{
          companyId: string;
          requestId: string;
          requestState: string;
          status: string;
        }>(
          sql`SELECT request.id::text AS "requestId",
                     request.company_id::text AS "companyId",
                     request.state::text AS "requestState",
                     action.status::text AS status
              FROM provisioning_action action
              JOIN license_request request
                ON request.id = action.request_id
               AND request.vendor_account_id = action.vendor_account_id
              WHERE action.id = ${parsed.actionId}::uuid
                AND action.kind = 'checklist'
                AND action.mode = 'orchestration'
              FOR UPDATE OF action, request`,
        );
        const [action] = locked.rows;
        if (
          !action ||
          !["pending", "sent"].includes(action.status) ||
          action.requestState !== "provisioning"
        ) {
          throw new Error("CHECKLIST_ACTION_NOT_PENDING");
        }
        await transaction.execute(
          sql`UPDATE provisioning_action
              SET status = 'failed', failure_reason = ${reason},
                  resolved_at = ${occurredAt}
              WHERE id = ${parsed.actionId}::uuid
                AND status IN ('pending','sent')`,
        );
        await applyLockedRequestTransition(transaction, authorization, {
          actorUserId: authorization.userAccountId,
          from: "provisioning",
          note: reason,
          occurredAt,
          requestId: action.requestId,
          to: "failed",
        });
        await transaction.execute(
          sql`INSERT INTO audit_log
                (actor_user_id, action, entity_type, entity_id, company_id,
                 note, before, after, occurred_at)
              VALUES
                (${authorization.userAccountId}::uuid,
                 'orchestration.checklist_failed', 'ProvisioningAction',
                 ${parsed.actionId}::uuid, ${action.companyId}::uuid, ${reason},
                 ${JSON.stringify({ status: action.status })}::jsonb,
                 ${JSON.stringify({
                   failureId: parsed.failureId,
                   reason,
                   status: "failed",
                 })}::jsonb, ${occurredAt})`,
        );
        return {
          requestId: action.requestId,
          status: "failed" as const,
        };
      });
    },

    async verifyChecklistObservation(untrustedInput: unknown) {
      const input = parseObservation(untrustedInput);
      return database.transaction(async (transaction) => {
        await transaction.execute(
          // Stryker disable next-line StringLiteral: @equivalent Changing the
          // stable advisory key only changes contention scope, not outcomes.
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`checklist-observation:${input.actionId}:${input.observationId}`}, 0))`,
        );
        const replay = await transaction.execute<{
          observedAssigned: string;
          observedAt: string;
          source: string;
          status: string;
        }>(
          sql`SELECT after->>'status' AS status
                     ,after->>'observedAssigned' AS "observedAssigned"
                     ,after->>'observedAt' AS "observedAt"
                     ,after->>'source' AS source
              FROM audit_log
              WHERE entity_type = 'ProvisioningAction'
                AND entity_id = ${input.actionId}::uuid
                AND action = 'orchestration.checklist_observed'
                AND after->>'observationId' = ${input.observationId}
              LIMIT 1`,
        );
        const [existing] = replay.rows;
        if (existing) {
          if (
            existing.observedAssigned !== String(input.observedAssigned) ||
            existing.observedAt !== input.observedAt.toISOString()
          ) {
            throw new Error("IDEMPOTENCY_CONFLICT");
          }
          return {
            status: existing.status as "confirmed" | "verification_failed",
          };
        }
        const locked = await transaction.execute<{
          companyId: string;
          requestState: string;
          resolvedAt: Date | string;
          status: string;
        }>(
          sql`SELECT request.company_id::text AS "companyId",
                     request.state::text AS "requestState",
                     action.resolved_at AS "resolvedAt",
                     action.status::text AS status
              FROM provisioning_action action
              JOIN license_request request
                ON request.id = action.request_id
               AND request.vendor_account_id = action.vendor_account_id
              JOIN license_assignment assignment
                ON assignment.id = request.license_assignment_id
               AND assignment.source_request_id = request.id
               AND assignment.company_id = request.company_id
               AND assignment.person_id = request.person_id
               AND assignment.vendor_account_id = request.vendor_account_id
               AND assignment.license_type_id = request.license_type_id
              WHERE action.id = ${input.actionId}::uuid
                AND action.kind = 'checklist'
                AND action.mode = 'orchestration'
                AND assignment.ended_on IS NULL
              FOR UPDATE OF action`,
        );
        const [action] = locked.rows;
        if (
          !action ||
          action.requestState !== "active" ||
          !["confirmed", "verification_failed"].includes(action.status)
        ) {
          throw new Error("CHECKLIST_OBSERVATION_NOT_APPLICABLE");
        }
        if (
          input.observedAt.getTime() <=
          new Date(action.resolvedAt).getTime()
        ) {
          throw new Error("CHECKLIST_OBSERVATION_STALE");
        }
        const status = input.observedAssigned
          ? "confirmed" as const
          : "verification_failed" as const;
        await transaction.execute(
          sql`UPDATE provisioning_action
              SET status = ${status},
                  failure_reason = ${
                    input.observedAssigned
                      ? null
                      : checklistAssignmentMissingFailureReason()
                  },
                  resolved_at = ${input.observedAt}
              WHERE id = ${input.actionId}::uuid`,
        );
        if (!input.observedAssigned) {
          const rule = await transaction.execute<{ id: string }>(
            sql`SELECT id::text
                FROM alert_rule
                WHERE type = 'provisioning_failure'
                  AND enabled
                  AND (
                    (scope_kind = 'company' AND company_id = ${action.companyId}::uuid)
                    OR scope_kind = 'global'
                  )
                ORDER BY CASE scope_kind WHEN 'company' THEN 0 ELSE 1 END, id
                LIMIT 1`,
          );
          const [alertRule] = rule.rows;
          if (!alertRule) throw new Error("PROVISIONING_FAILURE_RULE_MISSING");
          await transaction.execute(
            sql`INSERT INTO alert_event
                  (alert_rule_id, fired_at, subject_ref, notified, dedupe_key)
                VALUES
                  (${alertRule.id}::uuid, ${input.observedAt},
                   ${JSON.stringify({
                     actionId: input.actionId,
                     companyId: action.companyId,
                     exception: "checklist_verification_failed",
                     source: input.source,
                   })}::jsonb,
                   '{"status":"pending"}',
                   ${`checklist-verification:${input.actionId}:${input.observationId}`})
                ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
          );
        }
        await transaction.execute(
          sql`INSERT INTO audit_log
                (actor_user_id, action, entity_type, entity_id, company_id,
                 before, after, occurred_at)
              VALUES
                (NULL, 'orchestration.checklist_observed',
                 'ProvisioningAction', ${input.actionId}::uuid,
                 ${action.companyId}::uuid,
                 ${JSON.stringify({ status: action.status })}::jsonb,
                   ${JSON.stringify({
                     observationId: input.observationId,
                     observedAssigned: input.observedAssigned,
                     observedAt: input.observedAt.toISOString(),
                     source: input.source,
                   status,
                 })}::jsonb, ${input.observedAt})`,
        );
        return { status };
      });
    },
  };
}

export function createOrchestrationService(
  connectionString: string,
  options: {
    readonly dispatcher?: ConnectorDispatcher;
    readonly now?: () => Date;
  } = {},
) {
  const pool = new pg.Pool({ connectionString });
  // Stryker disable next-line ObjectLiteral: @equivalent Drizzle's runtime
  // SQL execution is unchanged without the compile-time schema map.
  const database = drizzle(pool, { schema });
  const operations = createOrchestrationOperations(database, options);
  return {
    async close(): Promise<void> {
      await pool.end();
    },
    ...operations,
  };
}

export type OrchestrationService = ReturnType<
  typeof createOrchestrationService
>;
