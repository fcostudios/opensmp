"use server";

import { forbidden, redirect } from "next/navigation";

import {
  loadProductionRetryAuthorization,
  productionProvisioningService,
} from "./retry-provisioning-production-dependencies";

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
