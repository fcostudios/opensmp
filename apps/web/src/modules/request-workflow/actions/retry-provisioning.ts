"use server";

import { forbidden, redirect } from "next/navigation";

import {
  retryProvisioningActionService,
} from "./retry-provisioning-action";

export async function retryProvisioning(input: FormData): Promise<void> {
  const result = await retryProvisioningActionService.retryProvisioning(input);
  if (result.ok) redirect(`/solicitudes/${result.requestId}?tab=actions`);
  if (result.error === "forbidden") forbidden();
  redirect(`/excepciones?tab=failed&retryError=${result.error}`);
}
