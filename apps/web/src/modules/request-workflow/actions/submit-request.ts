"use server";

import { auth } from "@/lib/auth/auth-config";
import {
  loadLedgerAuthorizationForSubject,
  recordLedgerAuthorizationFailure,
} from "../../identity-access/server-authorization";
import { requestRepository } from "../repository";
import {
  submitRequestPolicy,
  type SubmitRequestActionState,
} from "./submit-request-policy";

export type { SubmitRequestActionState } from "./submit-request-policy";

/**
 * @read-only-action The mutation is delegated to requestRepository.submit,
 * which owns one atomic transaction for Person, request, transitions and audit.
 */
export async function submitRequest(
  untrustedInput: unknown,
): Promise<SubmitRequestActionState> {
  const session = await auth();
  return submitRequestPolicy({
    input: untrustedInput,
    loadAuthorization: ({ subject }) =>
      loadLedgerAuthorizationForSubject(subject),
    occurredAt: new Date(),
    recordAuthorizationFailure: recordLedgerAuthorizationFailure,
    repository: requestRepository,
    subject: session?.user?.idpSubject ?? null,
  });
}
