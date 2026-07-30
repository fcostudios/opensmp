"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth/auth-config";
import {
  loadLedgerAuthorizationForSubject,
  recordLedgerAuthorizationFailure,
} from "../../identity-access/server-authorization";
import { approvalRepository } from "../approval-repository";
import {
  decideRequestPolicy,
  type DecideRequestPolicyResult,
} from "./decide-request-policy";

export type DecideRequestActionState = DecideRequestPolicyResult;

/**
 * @read-only-action This wrapper validates and dispatches to the lifecycle
 * service; the request, transition, decision fields, and audit are committed
 * by one canonical withAudit transaction.
 */
export async function decideRequest(
  untrustedInput: unknown,
): Promise<DecideRequestActionState> {
  const session = await auth();
  const result = await decideRequestPolicy({
    input: untrustedInput,
    subject: session?.user?.idpSubject ?? null,
    loadAuthorization: ({ subject }) =>
      loadLedgerAuthorizationForSubject(subject),
    recordAuthorizationFailure: recordLedgerAuthorizationFailure,
    repository: approvalRepository,
    occurredAt: new Date(),
  });
  if (result.ok) revalidatePath("/aprobaciones");
  return result;
}
