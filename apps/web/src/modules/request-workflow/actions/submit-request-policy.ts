import { submitRequestSchema } from "@smp/contracts";
import { hasCapability } from "@smp/domain/identity-access";

import {
  type AuthorizationRepository,
  type LedgerAuthorization,
} from "../../identity-access/authorization";
import {
  RequestIntakeError,
  type RequestRepository,
  type RequestWarning,
} from "../repository";

export type SubmitRequestActionState =
  | {
      readonly ok: true;
      readonly requestId: string;
      readonly redirectTo: string;
      readonly warnings: readonly RequestWarning[];
    }
  | {
      readonly ok: false;
      readonly error:
        | "invalid_request"
        | "forbidden"
        | "self_identity_unavailable"
        | "on_behalf_forbidden"
        | "company_inactive"
        | "vendor_account_inactive"
        | "license_type_inactive"
        | "vendor_license_mismatch"
        | "person_email_conflict"
        | "person_inactive"
        | "active_assignment_exists"
        | "idempotency_conflict"
        | "submission_failed";
      readonly href?: string;
    };

export async function submitRequestPolicy({
  input,
  loadAuthorization,
  occurredAt,
  recordAuthorizationFailure,
  repository,
  subject,
}: {
  readonly input: unknown;
  readonly loadAuthorization: (
    input: { readonly subject: string | null },
  ) => Promise<LedgerAuthorization | null>;
  readonly occurredAt: Date;
  readonly recordAuthorizationFailure:
    AuthorizationRepository["recordAuthorizationFailure"];
  readonly repository: RequestRepository;
  readonly subject: string | null;
}): Promise<SubmitRequestActionState> {
  const parsed = submitRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_request" };
  const authorization = await loadAuthorization({ subject });
  if (!authorization) return { ok: false, error: "forbidden" };
  const targetCompanyId =
    parsed.data.requestFor === "self"
      ? authorization.employeeCompanyId
      : parsed.data.personCompanyId;
  const hasOnBehalfAuthority =
    parsed.data.requestFor === "self" ||
    authorization.globalRole === "group_admin" ||
    authorization.companyGrants.some(
      (grant) =>
        grant.companyId === targetCompanyId &&
        grant.role === "approver",
    );
  if (
    targetCompanyId === null ||
    !hasOnBehalfAuthority ||
    !hasCapability(authorization, "request:create", targetCompanyId)
  ) {
    await recordAuthorizationFailure({
      actorUserId: authorization.userAccountId,
      capability: "request:create",
      companyId: targetCompanyId,
      errorCode: "capability_forbidden",
    });
    return { ok: false, error: "forbidden" };
  }
  try {
    const result = await repository.submit(
      authorization,
      parsed.data,
      occurredAt,
    );
    return {
      ok: true,
      requestId: result.requestId,
      redirectTo: result.redirectTo,
      warnings: result.warnings,
    };
  } catch (error) {
    if (error instanceof RequestIntakeError) {
      return {
        ok: false,
        error: error.code,
        ...(error.href ? { href: error.href } : {}),
      };
    }
    return { ok: false, error: "submission_failed" };
  }
}
