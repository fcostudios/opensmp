import { randomUUID } from "node:crypto";

import {
  createConnectorDispatcher,
  planProvisioningAction,
  type ConnectorDispatcher,
  type ConnectorProtocol,
} from "@smp/connectors";
// eslint-disable-next-line no-restricted-imports -- This module is the atomic cross-organization move transaction service.
import {
  auditLog,
  licenseRequest,
  provisioningAction,
} from "@smp/db/schema";
// eslint-disable-next-line no-restricted-imports -- This module is the atomic cross-organization move transaction service.
import * as schema from "@smp/db/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";

import type { LedgerAuthorization } from "../identity-access/authorization";
import { applyLockedRequestTransition } from "../request-workflow/transition-core";

export interface CrossOrgMoveInput {
  readonly assignmentId: string;
  readonly clientRequestId: string;
  readonly effectiveOn: string;
  readonly targetVendorAccountId: string;
}

export interface CrossOrgMoveOperation {
  readonly id: string;
  readonly kind: "checklist" | "invite" | "remove";
  readonly requestId: string;
}

interface MoveResult {
  readonly destinationOperation: CrossOrgMoveOperation;
  readonly sourceOperation: CrossOrgMoveOperation;
  readonly status: "executed" | "replayed";
}

type SourceWire = {
  accountMode: "automated" | "orchestration";
  assignmentId: string;
  canDeprovision: boolean;
  canProvision: boolean;
  companyId: string;
  licenseTypeId: string;
  licenseTypeName: string;
  personEmail: string;
  personId: string;
  provisioningProtocol: ConnectorProtocol;
  requestId: string;
  requestState: string;
  sourceVendorAccountId: string;
  vendorId: string;
};

type TargetWire = {
  accountMode: "automated" | "orchestration";
  canDeprovision: boolean;
  canProvision: boolean;
  provisioningProtocol: ConnectorProtocol;
  targetVendorAccountId: string;
};

function requireIsoDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError("effectiveOn must be an ISO date");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError("effectiveOn must be an ISO date");
  }
  return value;
}

export function createCrossOrgMoveService(
  connectionString: string,
  {
    dispatcher = createConnectorDispatcher(),
    now = () => new Date(),
  }: {
    readonly dispatcher?: ConnectorDispatcher;
    readonly now?: () => Date;
  } = {},
) {
  const pool = new pg.Pool({ connectionString });
  // Stryker disable next-line ObjectLiteral: @equivalent Runtime table
  // operations work without this option; the schema is required for the
  // transaction's compile-time type shared by the lifecycle core.
  const database = drizzle(pool, { schema });
  return {
    async close(): Promise<void> {
      await pool.end();
    },

    async move(
      authorization: LedgerAuthorization,
      input: CrossOrgMoveInput,
    ): Promise<MoveResult> {
      if (authorization.globalRole !== "group_admin") {
        throw new Error("CROSS_ORG_MOVE_FORBIDDEN");
      }
      if (!input.clientRequestId.trim()) {
        throw new TypeError("clientRequestId is required");
      }
      const effectiveOn = requireIsoDate(input.effectiveOn);
      const occurredAt = now();
      if (Number.isNaN(occurredAt.getTime())) {
        throw new TypeError("processing clock returned an invalid instant");
      }

      return database.transaction(async (transaction) => {
        const advisoryKey =
          // Stryker disable next-line StringLiteral: @equivalent Any stable
          // key serializes correctness; scoping preserves unrelated throughput.
          `cross-org-move:${input.assignmentId}:${input.clientRequestId}`;
        await transaction.execute(
          sql`SELECT pg_advisory_xact_lock(
                hashtextextended(
                  ${advisoryKey},
                  0
                )
              )`,
        );
        const replay = await transaction.execute<{
          actorUserId: string;
          destinationOperationId: string;
          destinationRequestId: string;
          effectiveOn: string;
          sourceOperationId: string;
          sourceRequestId: string;
          targetVendorAccountId: string;
        }>(
          sql`SELECT actor_user_id::text AS "actorUserId",
                     after->>'destinationOperationId' AS "destinationOperationId",
                     after->>'destinationRequestId' AS "destinationRequestId",
                     after->>'effectiveOn' AS "effectiveOn",
                     after->>'sourceOperationId' AS "sourceOperationId",
                     after->>'sourceRequestId' AS "sourceRequestId",
                     after->>'targetVendorAccountId' AS "targetVendorAccountId"
              FROM audit_log
              WHERE entity_type = 'CrossOrgMove'
                AND entity_id = ${input.assignmentId}::uuid
                AND after->>'clientRequestId' = ${input.clientRequestId}
              LIMIT 1`,
        );
        const [existing] = replay.rows;
        if (existing) {
          if (
            existing.actorUserId !== authorization.userAccountId ||
            existing.effectiveOn !== effectiveOn ||
            existing.targetVendorAccountId !== input.targetVendorAccountId
          ) {
            throw new Error("IDEMPOTENCY_CONFLICT");
          }
          const actions = await transaction.execute<{
            id: string;
            kind: CrossOrgMoveOperation["kind"];
            requestId: string;
          }>(
            sql`SELECT id::text, kind::text, request_id::text AS "requestId"
                FROM provisioning_action
                WHERE id IN (
                  ${existing.sourceOperationId}::uuid,
                  ${existing.destinationOperationId}::uuid
                )`,
          );
          const byId = new Map(actions.rows.map((action) => [action.id, action]));
          const sourceOperation = byId.get(existing.sourceOperationId);
          const destinationOperation = byId.get(
            existing.destinationOperationId,
          );
          if (
            !sourceOperation ||
            !destinationOperation ||
            sourceOperation.requestId !== existing.sourceRequestId ||
            (
              sourceOperation.kind !== "remove" &&
              sourceOperation.kind !== "checklist"
            ) ||
            destinationOperation.requestId !==
              existing.destinationRequestId ||
            (
              destinationOperation.kind !== "invite" &&
              destinationOperation.kind !== "checklist"
            )
          ) {
            throw new Error("CROSS_ORG_MOVE_REPLAY_INTEGRITY");
          }
          return {
            destinationOperation,
            sourceOperation,
            status: "replayed" as const,
          };
        }

        const sourceResult = await transaction.execute<SourceWire>(
          sql`SELECT assignment.id::text AS "assignmentId",
                     assignment.company_id::text AS "companyId",
                     assignment.person_id::text AS "personId",
                     assignment.license_type_id::text AS "licenseTypeId",
                     assignment.vendor_account_id::text AS "sourceVendorAccountId",
                     request.id::text AS "requestId",
                     request.state::text AS "requestState",
                     holder.email AS "personEmail",
                     license.name AS "licenseTypeName",
                     account.mode::text AS "accountMode",
                     vendor.id::text AS "vendorId",
                     vendor.provisioning_protocol::text AS "provisioningProtocol",
                     vendor.can_provision AS "canProvision",
                     vendor.can_deprovision AS "canDeprovision"
              FROM license_assignment assignment
              JOIN license_request request
                ON request.id = assignment.source_request_id
               AND request.person_id = assignment.person_id
               AND request.company_id = assignment.company_id
               AND request.vendor_account_id = assignment.vendor_account_id
               AND request.license_type_id = assignment.license_type_id
              JOIN person holder
                ON holder.id = assignment.person_id
               AND holder.company_id = assignment.company_id
              JOIN company tenant ON tenant.id = assignment.company_id
              JOIN vendor_account account
                ON account.id = assignment.vendor_account_id
               AND account.status = 'active'
              JOIN vendor ON vendor.id = account.vendor_id
              JOIN license_type license
                ON license.id = assignment.license_type_id
               AND license.vendor_id = vendor.id
               AND license.status = 'active'
              WHERE assignment.id = ${input.assignmentId}::uuid
                AND assignment.ended_on IS NULL
              FOR UPDATE OF assignment, request`,
        );
        const [source] = sourceResult.rows;
        if (!source) throw new Error("MOVE_REQUEST_MISMATCH");
        if (source.requestState !== "active") {
          throw new Error("MOVE_REQUEST_NOT_ACTIVE");
        }
        if (source.sourceVendorAccountId === input.targetVendorAccountId) {
          throw new Error("CROSS_ORG_MOVE_REQUIRES_DISTINCT_ACCOUNTS");
        }
        const targetResult = await transaction.execute<TargetWire>(
          sql`SELECT account.id::text AS "targetVendorAccountId",
                     account.mode::text AS "accountMode",
                     vendor.provisioning_protocol::text AS "provisioningProtocol",
                     vendor.can_provision AS "canProvision",
                     vendor.can_deprovision AS "canDeprovision"
              FROM vendor_account account
              JOIN vendor
                ON vendor.id = account.vendor_id
               AND vendor.id = ${source.vendorId}::uuid
              WHERE account.id = ${input.targetVendorAccountId}::uuid
                AND account.status = 'active'`,
        );
        const [target] = targetResult.rows;
        if (!target) throw new Error("MOVE_TARGET_INCOMPATIBLE");

        const destinationRequestId = randomUUID();
        const instruction = {
          licenseTypeName: source.licenseTypeName,
          personEmail: source.personEmail,
          requestId: source.requestId,
          vendorAccountId: source.sourceVendorAccountId,
        };
        const sourcePlan = await planProvisioningAction(dispatcher, {
          accountMode: source.accountMode,
          context: {
            assignmentIds: [source.assignmentId],
            clientRequestId: input.clientRequestId,
            effectiveOn,
          },
          entityIds: {
            licenseId: source.licenseTypeId,
            personId: source.personId,
          },
          instruction,
          operation: "deprovision",
          vendor: {
            canDeprovision: source.canDeprovision,
            canProvision: source.canProvision,
            provisioningProtocol: source.provisioningProtocol,
          },
        });
        const destinationPlan = await planProvisioningAction(dispatcher, {
          accountMode: target.accountMode,
          context: {
            clientRequestId: input.clientRequestId,
            effectiveOn,
            sourceAssignmentId: source.assignmentId,
          },
          entityIds: {
            licenseId: source.licenseTypeId,
            personId: source.personId,
          },
          instruction: {
            ...instruction,
            requestId: destinationRequestId,
            vendorAccountId: target.targetVendorAccountId,
          },
          operation: "provision",
          vendor: {
            canDeprovision: target.canDeprovision,
            canProvision: target.canProvision,
            provisioningProtocol: target.provisioningProtocol,
          },
        });

        await applyLockedRequestTransition(transaction, authorization, {
          actorUserId: authorization.userAccountId,
          from: "active",
          note: "Cross-organization move: enqueue source deprovision",
          occurredAt,
          requestId: source.requestId,
          to: "offboarding",
        });
        await transaction.insert(licenseRequest).values({
          id: destinationRequestId,
          requestNo: `MOVE-${randomUUID()}`,
          personId: source.personId,
          companyId: source.companyId,
          vendorAccountId: target.targetVendorAccountId,
          licenseTypeId: source.licenseTypeId,
          state: "submitted",
          justification: "Cross-organization move",
          neededBy: effectiveOn,
          requestedBy: authorization.userAccountId,
          createdAt: occurredAt,
          createdBy: authorization.userAccountId,
        });
        for (const [from, to, note] of [
          ["submitted", "pending_approval", "Cross-organization move submitted"],
          ["pending_approval", "approved", "Cross-organization move approved"],
          ["approved", "provisioning", "Cross-organization move provisioning"],
        ] as const) {
          await applyLockedRequestTransition(transaction, authorization, {
            actorUserId: authorization.userAccountId,
            from,
            note,
            occurredAt,
            requestId: destinationRequestId,
            to,
          });
        }
        const [sourceAction] = await transaction
          .insert(provisioningAction)
          .values({
            requestId: source.requestId,
            vendorAccountId: source.sourceVendorAccountId,
            kind: sourcePlan.kind,
            mode: sourcePlan.mode,
            status: sourcePlan.status,
            rawRequest: sourcePlan.rawRequest,
            createdAt: occurredAt,
          })
          .returning({
            id: provisioningAction.id,
            kind: provisioningAction.kind,
            requestId: provisioningAction.requestId,
          });
        const [destinationAction] = await transaction
          .insert(provisioningAction)
          .values({
            requestId: destinationRequestId,
            vendorAccountId: target.targetVendorAccountId,
            kind: destinationPlan.kind,
            mode: destinationPlan.mode,
            status: destinationPlan.status,
            rawRequest: destinationPlan.rawRequest,
            createdAt: occurredAt,
          })
          .returning({
            id: provisioningAction.id,
            kind: provisioningAction.kind,
            requestId: provisioningAction.requestId,
          });
        // Stryker disable all: @equivalent PostgreSQL INSERT ... RETURNING
        // produces one row here or Drizzle throws; an empty successful result
        // cannot be induced through the repository contract.
        /* c8 ignore next 3 */
        if (!sourceAction || !destinationAction) {
          throw new Error("CROSS_ORG_MOVE_ACTION_INSERT_FAILED");
        }
        // Stryker restore all
        await transaction.insert(auditLog).values({
          actorUserId: authorization.userAccountId,
          action: "license_assignment.cross_org_move_enqueued",
          entityType: "CrossOrgMove",
          entityId: source.assignmentId,
          companyId: source.companyId,
          before: {
            requestId: source.requestId,
            requestState: "active",
            vendorAccountId: source.sourceVendorAccountId,
          },
          after: {
            clientRequestId: input.clientRequestId,
            destinationOperationId: destinationAction.id,
            destinationRequestId,
            effectiveOn,
            sourceOperationId: sourceAction.id,
            sourceRequestId: source.requestId,
            targetVendorAccountId: target.targetVendorAccountId,
          },
          occurredAt,
        });
        return {
          destinationOperation: {
            ...destinationAction,
            kind: destinationPlan.kind,
          },
          sourceOperation: {
            ...sourceAction,
            kind: sourcePlan.kind,
          },
          status: "executed" as const,
        };
      });
    },
  };
}
