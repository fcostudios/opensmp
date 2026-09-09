import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { forbidden } from "next/navigation";
import { z } from "zod";

// eslint-disable-next-line no-restricted-imports -- This module owns production wiring for the audited retry transaction.
import { db } from "@smp/db";
// eslint-disable-next-line no-restricted-imports -- This action adapter only types its transaction-service dependency.
import type * as schema from "@smp/db/schema";

import { withAudit } from "../../audit/with-audit";
import {
  AUTHORIZATION_SYSTEM_ENTITY_ID,
  type LedgerAuthorization,
} from "../../identity-access/authorization";
import { loadCurrentLedgerAuthorization } from "../../identity-access/server-authorization";
import { createProvisioningService } from "../provisioning-service";

export type RetryProvisioningDatabase = NodePgDatabase<typeof schema>;

export function retryProvisioningFailureDestination(
  error: "conflict" | "forbidden" | "invalid",
): string {
  if (error === "forbidden") forbidden();
  return `/excepciones?tab=failed&retryError=${error}`;
}

export function createRetryProvisioningActionService({
  database,
  loadAuthorization,
  now = () => new Date(),
}: {
  readonly database: RetryProvisioningDatabase;
  readonly loadAuthorization: () => Promise<LedgerAuthorization | null>;
  readonly now?: () => Date;
}) {
  return {
    async retryProvisioning(input: FormData | { readonly actionId?: unknown }) {
      return withAudit(database, async (transaction) => {
        const occurredAt = now();
        const normalized = input instanceof FormData
          ? { actionId: input.get("actionId") }
          : input;
        const actionId = z.string().uuid().safeParse(normalized.actionId);
        const authorization = await loadAuthorization();
        const service = createProvisioningService(transaction, {
          now: () => occurredAt,
        });
        const result = await service.retryProvisioning(authorization, normalized);
        return {
          value: result,
          audit: {
            actorUserId: authorization?.userAccountId ?? null,
            action: "server_action.retryProvisioning",
            entityType: "ProvisioningAction",
            entityId: actionId.success
              ? actionId.data
              : AUTHORIZATION_SYSTEM_ENTITY_ID,
            companyId: null,
            note: null,
            before: null,
            after: result.ok
              ? { accepted: true }
              : { accepted: false, errorCode: result.error },
          },
        };
      }, { occurredAt: now() });
    },
  };
}

const productionDatabase = db as unknown as RetryProvisioningDatabase;
export const retryProvisioningActionService = createRetryProvisioningActionService({
  database: productionDatabase,
  loadAuthorization: loadCurrentLedgerAuthorization,
});
