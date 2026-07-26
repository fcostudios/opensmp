import { NextResponse } from "next/server";

import {
  authorizeCompanyDataAccess,
  AuthorizationError,
  type AuthorizationRepository,
  type LedgerAuthorization,
} from "./authorization";
import type { Capability } from "@smp/domain/identity-access";

type SubjectSession = {
  readonly user: { readonly idpSubject: string };
};

export type CompanyRequestAuthorization =
  | { readonly ok: true; readonly authorization: LedgerAuthorization }
  | { readonly ok: false; readonly response: NextResponse };

export async function authorizeCompanyRequestWithSession(
  session: SubjectSession | null,
  repository: AuthorizationRepository,
  input: {
    readonly companyId: string;
    readonly capability: Capability;
  },
): Promise<CompanyRequestAuthorization> {
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      ),
    };
  }

  try {
    const authorization = await authorizeCompanyDataAccess(repository, {
      subject: session.user.idpSubject,
      ...input,
    });
    return { ok: true, authorization };
  } catch (cause) {
    if (!(cause instanceof AuthorizationError)) throw cause;
    await repository.recordAuthorizationFailure({
      actorUserId: cause.actorUserId,
      capability: cause.capability,
      companyId: cause.companyId,
      errorCode: cause.code,
    });
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
}
