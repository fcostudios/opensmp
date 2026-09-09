"use server";

import { redirect } from "next/navigation";

import type { RetryProvisioningResult } from "../provisioning-service";
import {
  loadProductionRetryAuthorization,
  productionProvisioningService,
} from "./retry-provisioning-production-dependencies";

export async function retryProvisioning(input: unknown): Promise<RetryProvisioningResult> {
  const authorization = await loadProductionRetryAuthorization();
  const result = await productionProvisioningService.retryProvisioning(
    authorization,
    input,
  );
  if (result.ok) redirect(`/solicitudes/${result.requestId}?tab=actions`);
  return result;
}
