import { decideRequestSchema } from "@smp/contracts";
import { hasCapability } from "@smp/domain/identity-access";

import type {
  AuthorizationRepository,
  LedgerAuthorization,
} from "../../identity-access/authorization";
import type { ApprovalRepository } from "../approval-repository";

export type DecideRequestPolicyResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error:
        | "invalid_decision"
        | "forbidden"
        | "decision_failed";
    };

export async function decideRequestPolicy({
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
  readonly repository: ApprovalRepository;
  readonly subject: string | null;
}): Promise<DecideRequestPolicyResult> {
  const parsed = decideRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid_decision" };
  }
  try {
    const companyId = await repository.decisionCompanyIdForAudit(
      parsed.data.requestId,
    );
    if (!companyId) return { ok: false, error: "forbidden" };
    const authorization = await loadAuthorization({
      subject,
    });
    if (
      !authorization ||
      !hasCapability(authorization, "request:approve", companyId)
    ) {
      await recordAuthorizationFailure({
        actorUserId: authorization?.userAccountId ?? null,
        capability: "request:approve",
        companyId,
        errorCode: "capability_forbidden",
      });
      return { ok: false, error: "forbidden" };
    }
    await repository.decide(authorization, parsed.data, occurredAt);
    return { ok: true };
  } catch {
    return { ok: false, error: "decision_failed" };
  }
}
