import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

import { db } from "@smp/db";
import * as schema from "@smp/db/schema";

import { withAudit } from "../../audit/with-audit";
import { AUTHORIZATION_SYSTEM_ENTITY_ID } from "../../identity-access/authorization";
import type { LedgerAuthorization } from "../../identity-access/authorization";
import {
  safeParseConfirmChecklist,
  safeParseFailChecklist,
} from "../orchestration-contract";
import { createLifecycleNotificationDispatcher } from "../lifecycle-notifications";
import { createOrchestrationOperations } from "../orchestration";
import {
  loadProductionChecklistAuthorization,
  productionChecklistClock,
} from "./checklist-action-production-dependencies";

type ChecklistDatabase = NodePgDatabase<typeof schema>;
type LoadAuthorization = () => Promise<LedgerAuthorization | null>;

export type ChecklistActionResult =
  | { readonly ok: true; readonly requestId: string }
  | { readonly ok: false; readonly error: "forbidden" | "invalid" | "conflict" };

function rejectedError(error: unknown): "invalid" | "conflict" {
  return error instanceof Error && error.message.includes("CONFLICT")
    ? "conflict"
    : "invalid";
}

export function createChecklistActionService(
  database: ChecklistDatabase,
  {
    loadAuthorization = loadProductionChecklistAuthorization,
    lifecycleDispatcher,
    now = productionChecklistClock,
  }: {
    readonly loadAuthorization?: LoadAuthorization;
    readonly lifecycleDispatcher?: ReturnType<
      typeof createLifecycleNotificationDispatcher
    >;
    readonly now?: () => Date;
  } = {},
) {
  return {
    async confirmChecklistDone(input: unknown): Promise<ChecklistActionResult> {
      return withAudit<ChecklistActionResult>(database, async (transaction) => {
        const occurredAt = now();
        const parsed = safeParseConfirmChecklist(input);
        const entityId = parsed.success
          ? parsed.data.actionId
          : AUTHORIZATION_SYSTEM_ENTITY_ID;
        const authorization = await loadAuthorization();
        if (!authorization || authorization.globalRole !== "group_admin") {
          return {
            value: { ok: false, error: "forbidden" } as const,
            audit: {
              actorUserId: authorization?.userAccountId ?? null,
              action: "authorization.denied",
              entityType: "ProvisioningAction",
              entityId,
              companyId: null,
              note: null,
              before: null,
              after: {
                capability: "orchestration:confirm",
                errorCode: "capability_forbidden",
              },
            },
          };
        }
        try {
          const operations = createOrchestrationOperations(transaction, {
            now: () => occurredAt,
          });
          const result = await operations.confirmChecklistDone(
            authorization,
            input,
          );
          return {
            value: { ok: true, requestId: result.requestId } as const,
            audit: {
              actorUserId: authorization.userAccountId,
              action: "server_action.confirmChecklistDone",
              entityType: "ProvisioningAction",
              entityId,
              companyId: null,
              note: null,
              before: null,
              after: { accepted: true },
            },
          };
        } catch (error) {
          const errorCode = rejectedError(error);
          return {
            value: { ok: false, error: errorCode } as const,
            audit: {
              actorUserId: authorization.userAccountId,
              action: "server_action.confirmChecklistDone",
              entityType: "ProvisioningAction",
              entityId,
              companyId: null,
              note: null,
              before: null,
              after: { accepted: false, errorCode },
            },
          };
        }
      }, {
        occurredAt: now(),
        afterCommit: async (result) => {
          const parsed = safeParseConfirmChecklist(input);
          if (!result.ok || !parsed.success || !lifecycleDispatcher) return;
          const request = await database.execute<{ requestId: string }>(
            sql`SELECT request.id::text AS "requestId"
                FROM provisioning_action action
                JOIN license_request request
                  ON request.id = action.request_id
                 AND request.vendor_account_id = action.vendor_account_id
                WHERE action.id = ${parsed.data.actionId}::uuid
                  AND request.state = 'active'`,
          );
          for (const { requestId } of request.rows) {
            await lifecycleDispatcher.dispatchRequest(requestId);
          }
        },
        onAfterCommitFailure: async (_error, result) => {
          const parsed = safeParseConfirmChecklist(input);
          // Stryker disable next-line ConditionalExpression,LogicalOperator:
          // @equivalent afterCommit can reject only after this same guard passes.
          if (!result.ok || !parsed.success) return;
          await database.execute(
            sql`INSERT INTO audit_log
                  (actor_user_id, action, entity_type, entity_id, company_id,
                   before, after, occurred_at)
                SELECT confirmation.actor_user_id,
                       'notification.post_commit_dispatch_failed',
                       'ProvisioningAction', action.id, request.company_id,
                       NULL, ${JSON.stringify({
                     errorCode: "POST_COMMIT_DISPATCH_FAILED",
                   })}::jsonb, ${now()}
                FROM provisioning_action action
                JOIN license_request request
                  ON request.id = action.request_id
                 AND request.vendor_account_id = action.vendor_account_id
                 AND request.state = 'active'
                JOIN license_assignment assignment
                  ON assignment.id = request.license_assignment_id
                 AND assignment.source_request_id = request.id
                 AND assignment.company_id = request.company_id
                 AND assignment.ended_on IS NULL
                JOIN audit_log confirmation
                  ON confirmation.entity_type = 'ProvisioningAction'
                 AND confirmation.entity_id = action.id
                 AND confirmation.action = 'orchestration.checklist_confirmed'
                 AND confirmation.company_id = request.company_id
                WHERE action.id = ${parsed.data.actionId}::uuid`,
          );
        },
      });
    },

    async markChecklistNotDone(input: unknown): Promise<ChecklistActionResult> {
      return withAudit<ChecklistActionResult>(database, async (transaction) => {
        const occurredAt = now();
        const parsed = safeParseFailChecklist(input);
        const entityId = parsed.success
          ? parsed.data.actionId
          : AUTHORIZATION_SYSTEM_ENTITY_ID;
        const authorization = await loadAuthorization();
        if (!authorization || authorization.globalRole !== "group_admin") {
          return {
            value: { ok: false, error: "forbidden" } as const,
            audit: {
              actorUserId: authorization?.userAccountId ?? null,
              action: "authorization.denied",
              entityType: "ProvisioningAction",
              entityId,
              companyId: null,
              note: null,
              before: null,
              after: {
                capability: "orchestration:fail",
                errorCode: "capability_forbidden",
              },
            },
          };
        }
        try {
          const operations = createOrchestrationOperations(transaction, {
            now: () => occurredAt,
          });
          const result = await operations.markChecklistNotDone(
            authorization,
            input,
          );
          return {
            value: { ok: true, requestId: result.requestId } as const,
            audit: {
              actorUserId: authorization.userAccountId,
              action: "server_action.markChecklistNotDone",
              entityType: "ProvisioningAction",
              entityId,
              companyId: null,
              note: null,
              before: null,
              after: { accepted: true },
            },
          };
        } catch (error) {
          const errorCode = rejectedError(error);
          return {
            value: { ok: false, error: errorCode } as const,
            audit: {
              actorUserId: authorization.userAccountId,
              action: "server_action.markChecklistNotDone",
              entityType: "ProvisioningAction",
              entityId,
              companyId: null,
              note: null,
              before: null,
              after: { accepted: false, errorCode },
            },
          };
        }
      }, { occurredAt: now() });
    },
  };
}

export function createProductionChecklistActionService(
  database: ChecklistDatabase,
  overrides: {
    readonly loadAuthorization?: LoadAuthorization;
    readonly now?: () => Date;
  } = {},
) {
  return createChecklistActionService(database, {
    ...overrides,
    lifecycleDispatcher: createLifecycleNotificationDispatcher(
      database,
      { workerId: "web-checklist-confirmation" },
    ),
  });
}

const productionDatabase = db as unknown as ChecklistDatabase;
export const checklistActionService =
  createProductionChecklistActionService(productionDatabase);
