import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { db } from "@smp/db";
import * as schema from "@smp/db/schema";

import { auth } from "@/lib/auth/auth-config";
import type { Capability } from "@smp/domain/identity-access";
import { createAuthorizationRepository } from "./authorization";
import {
  authorizeCompanyRequestWithSession,
  type CompanyRequestAuthorization,
} from "./authorization-response";

const authorizationRepository = createAuthorizationRepository(
  db as unknown as NodePgDatabase<typeof schema>,
);

/**
 * Secure DAL entry point for every company-scoped Route Handler or Server
 * Action. Call it immediately before the scoped query/mutation and return
 * `result.response` when `ok` is false.
 */
export async function authorizeCompanyRequest(input: {
  readonly companyId: string;
  readonly capability: Capability;
}): Promise<CompanyRequestAuthorization> {
  const session = await auth();
  return authorizeCompanyRequestWithSession(session, authorizationRepository, {
    companyId: input.companyId,
    capability: input.capability,
  });
}

export async function loadCurrentLedgerAuthorization() {
  const session = await auth();
  if (!session?.user?.idpSubject) return null;
  return loadLedgerAuthorizationForSubject(session.user.idpSubject);
}

/** Route handlers already holding a verified OIDC subject use this DB-backed lookup. */
export async function loadLedgerAuthorizationForSubject(
  subject: string | null,
) {
  return authorizationRepository.load({ subject });
}

export async function recordLedgerAuthorizationFailure(
  input: Parameters<
    typeof authorizationRepository.recordAuthorizationFailure
  >[0],
) {
  return authorizationRepository.recordAuthorizationFailure(input);
}
