import { createConnectorDispatcher, type ConnectorDispatcher } from "@smp/connectors";
// eslint-disable-next-line no-restricted-imports -- This transaction service owns the retry capacity lock and routing boundary.
import {
  lockRequestCapacityPool,
  routeProvisioningActionInTransaction,
} from "@smp/db/provisioning-routing";
import type * as schema from "@smp/db/schema";
import { hasCapability } from "@smp/domain/identity-access";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";

import type { LedgerAuthorization } from "../identity-access/authorization";

type Database = NodePgDatabase<typeof schema>;

const retryProvisioningSchema = z.object({
  actionId: z.string().uuid(),
}).strict();

export type RetryProvisioningResult =
  | { readonly ok: true; readonly requestId: string }
  | { readonly ok: false; readonly error: "conflict" | "forbidden" | "invalid" };

export function createProvisioningService(
  database: Database,
  {
    dispatcher = createConnectorDispatcher(),
    now = () => new Date(),
  }: {
    readonly dispatcher?: ConnectorDispatcher;
    readonly now?: () => Date;
  } = {},
) {
  return {
    async retryProvisioning(
      authorization: LedgerAuthorization | null,
      input: unknown,
    ): Promise<RetryProvisioningResult> {
      const parsed = retryProvisioningSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: "invalid" };
      const occurredAt = now();
      return database.transaction(async (transaction) => {
        const located = await transaction.execute<{
          readonly companyId: string;
          readonly requestId: string;
        }>(sql`SELECT request.id::text AS "requestId",
                     request.company_id::text AS "companyId"
              FROM provisioning_action action
              JOIN license_request request
                ON request.id=action.request_id
               AND request.vendor_account_id=action.vendor_account_id
              WHERE action.id=${parsed.data.actionId}::uuid
                AND action.kind='invite'
                AND action.mode='automated'`);
        const target = located.rows[0];
        if (!target) return { ok: false, error: "invalid" } as const;
        if (
          !authorization
          || !hasCapability(authorization, "request:approve", target.companyId)
        ) {
          await transaction.execute(sql`INSERT INTO audit_log
            (actor_user_id,action,entity_type,entity_id,company_id,note,before,after,occurred_at)
          VALUES (${authorization?.userAccountId ?? null}::uuid,'authorization.denied',
            'ProvisioningAction',${parsed.data.actionId}::uuid,${target.companyId}::uuid,
            NULL,NULL,${JSON.stringify({
              capability: "request:approve",
              errorCode: "capability_forbidden",
            })}::jsonb,${occurredAt})`);
          return { ok: false, error: "forbidden" } as const;
        }

        try {
          await lockRequestCapacityPool(
            transaction,
            target.requestId,
            authorization.companyIds,
            "PROVISIONING_RETRY_FORBIDDEN",
          );
          const retryable = await transaction.execute<{ readonly requestId: string }>(
            sql`SELECT request.id::text AS "requestId"
                FROM provisioning_action action
                JOIN license_request request
                  ON request.id=action.request_id
                 AND request.vendor_account_id=action.vendor_account_id
                 AND request.company_id=${target.companyId}::uuid
                WHERE action.id=${parsed.data.actionId}::uuid
                  AND action.kind='invite'
                  AND action.mode='automated'
                  AND action.status='failed'
                  AND action.failure_reason='provider_invitation_failed'
                  AND request.state='failed'
                  AND EXISTS (
                    SELECT 1 FROM connector_call_observation observation
                    WHERE observation.provisioning_action_id=action.id
                      AND observation.vendor_account_id=action.vendor_account_id
                      AND observation.phase='failed'
                      AND COALESCE(observation.summary->>'failure_code','') <> 'capacity_unavailable'
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM provisioning_action live
                    WHERE live.request_id=request.id
                      AND live.raw_request->>'operation'='provision'
                      AND live.status IN ('pending','sent')
                  )
                FOR UPDATE OF action,request`,
          );
          if (retryable.rows.length !== 1) {
            return { ok: false, error: "conflict" } as const;
          }
          await routeProvisioningActionInTransaction(transaction, {
            actorUserId: authorization.userAccountId,
            expectedState: "failed",
            note: "Provisioning retry issued",
            occurredAt,
            requestId: target.requestId,
          }, dispatcher);
          return { ok: true, requestId: target.requestId } as const;
        } catch {
          return { ok: false, error: "conflict" } as const;
        }
      });
    },
  };
}
