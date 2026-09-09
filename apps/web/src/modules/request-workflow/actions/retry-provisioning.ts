"use server";

import { db } from "@smp/db";
import type * as schema from "@smp/db/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { forbidden, redirect } from "next/navigation";

import type { LedgerAuthorization } from "../../identity-access/authorization";
import { createProvisioningService } from "../provisioning-service";

async function loadProductionRetryAuthorization(): Promise<LedgerAuthorization | null> {
  const { loadCurrentLedgerAuthorization } = await import(
    "../../identity-access/server-authorization"
  );
  return loadCurrentLedgerAuthorization();
}

const productionDatabase = db as unknown as NodePgDatabase<typeof schema>;
const productionProvisioningService = createProvisioningService(productionDatabase);

export function retryProvisioningFailureDestination(
  error: "conflict" | "forbidden" | "invalid",
): string {
  if (error === "forbidden") forbidden();
  return `/excepciones?tab=failed&retryError=${error}`;
}

export async function retryProvisioning(input: FormData): Promise<void> {
  const normalized = input instanceof FormData
    ? { actionId: input.get("actionId") }
    : input;
  const authorization = await loadProductionRetryAuthorization();
  const result = await productionProvisioningService.retryProvisioning(
    authorization,
    normalized,
  );
  if (result.ok) redirect(`/solicitudes/${result.requestId}?tab=actions`);
  redirect(retryProvisioningFailureDestination(result.error));
}
