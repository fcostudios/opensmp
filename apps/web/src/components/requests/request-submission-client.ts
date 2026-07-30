import type { SubmitRequestInput } from "@smp/contracts";

import type { SubmitRequestActionState } from "@/modules/request-workflow/actions/submit-request";

export type SemanticRequestInput =
  | Omit<
      Extract<SubmitRequestInput, { readonly requestFor: "self" }>,
      "clientRequestId"
    >
  | Omit<
      Extract<SubmitRequestInput, { readonly requestFor: "on_behalf" }>,
      "clientRequestId"
    >;

export interface RequestAttempt {
  readonly fingerprint: string;
  readonly clientRequestId: string;
}

export function nextRequestAttempt(
  semanticInput: object,
  previous: RequestAttempt | null,
  generateClientRequestId: () => string,
): RequestAttempt {
  const fingerprint = JSON.stringify(semanticInput);
  return previous?.fingerprint === fingerprint
    ? previous
    : {
        fingerprint,
        clientRequestId: generateClientRequestId(),
      };
}

export function createdRequestUrl(redirectTo: string): string {
  return `${redirectTo}?created=1`;
}

export function requestInputFromForm(
  data: FormData,
  requestFor: SubmitRequestInput["requestFor"],
): SemanticRequestInput {
  const common = {
    vendorAccountId: String(data.get("vendorAccountId") ?? ""),
    licenseTypeId: String(data.get("licenseTypeId") ?? ""),
    justification: String(data.get("justification") ?? ""),
    ...(data.get("neededBy")
      ? { neededBy: String(data.get("neededBy")) }
      : {}),
  };
  return requestFor === "self"
    ? { ...common, requestFor: "self" }
    : {
        ...common,
        requestFor: "on_behalf",
        personEmail: String(data.get("personEmail") ?? ""),
        personFullName: String(data.get("personFullName") ?? ""),
        personCompanyId: String(data.get("personCompanyId") ?? ""),
      };
}

export function submissionSettlement(result: SubmitRequestActionState): {
  readonly succeeded: boolean;
  readonly destination: string | null;
} {
  return result.ok
    ? {
        succeeded: true,
        destination: createdRequestUrl(result.redirectTo),
      }
    : { succeeded: false, destination: null };
}

export function submissionAllowed(succeeded: boolean): boolean {
  return !succeeded;
}
