"use server";

import { redirect } from "next/navigation";

import {
  loadProductionRetryAuthorization,
  productionProvisioningService,
} from "./retry-provisioning-production-dependencies";

export class RetryProvisioningForbiddenError extends Error {
  readonly status = 403;

  constructor() {
    super("RETRY_PROVISIONING_FORBIDDEN");
  }
}

export function retryProvisioningFailureDestination(
  error: "conflict" | "forbidden" | "invalid",
): string {
  if (error === "forbidden") throw new RetryProvisioningForbiddenError();
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
