"use server";

// eslint-disable-next-line no-restricted-imports -- This server action wires the production transaction service.
import { db } from "@smp/db";
// eslint-disable-next-line no-restricted-imports -- This server action only types the production transaction service dependency.
import type * as schema from "@smp/db/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { forbidden, redirect } from "next/navigation";

import type { LedgerAuthorization } from "../../identity-access/authorization";
import { loadCurrentLedgerAuthorization } from "../../identity-access/server-authorization";
import { createProvisioningService } from "../provisioning-service";

const productionDatabase = db as unknown as NodePgDatabase<typeof schema>;

export function retryProvisioningFailureDestination(
  error: "conflict" | "forbidden" | "invalid",
): string {
  if (error === "forbidden") forbidden();
  return `/excepciones?tab=failed&retryError=${error}`;
}

export function createRetryProvisioningAction({
  database,
  loadAuthorization,
  navigate,
}: {
  readonly database: NodePgDatabase<typeof schema>;
  readonly loadAuthorization: () => Promise<LedgerAuthorization | null>;
  readonly navigate: (destination: string) => void;
}) {
  const service = createProvisioningService(database);

  return async (input: FormData | { readonly actionId?: unknown }): Promise<void> => {
    const normalized = input instanceof FormData
      ? { actionId: input.get("actionId") }
      : input;
    const authorization = await loadAuthorization();
    const result = await service.retryProvisioning(authorization, normalized);
    if (result.ok) {
      navigate(`/solicitudes/${result.requestId}?tab=actions`);
      return;
    }
    navigate(retryProvisioningFailureDestination(result.error));
  };
}

export const retryProvisioning = createRetryProvisioningAction({
  database: productionDatabase,
  loadAuthorization: loadCurrentLedgerAuthorization,
  navigate: redirect,
});
