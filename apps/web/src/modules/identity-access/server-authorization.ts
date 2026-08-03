import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { db } from "@smp/db";
import * as schema from "@smp/db/schema";

import type { Capability } from "@smp/domain/identity-access";
import {
  createAuthorizationRepository,
  type AuthorizationRepository,
} from "./authorization";
import {
  authorizeCompanyRequestWithSession,
  type CompanyRequestAuthorization,
} from "./authorization-response";
import { keycloakUserAdminFromEnvironment } from "./keycloak-admin";
import { createUserAdminService } from "./user-admin-service";

const authorizationRepository = createAuthorizationRepository(
  db as unknown as NodePgDatabase<typeof schema>,
);

type LedgerSession = {
  readonly user?: { readonly idpSubject?: string };
} | null;

async function loadProductionSession(): Promise<LedgerSession> {
  const { auth } = await import("@/lib/auth/auth-config");
  return auth();
}

export function createServerAuthorizationEntrypoints(dependencies: {
  readonly loadSession: () => Promise<LedgerSession>;
  readonly repository: AuthorizationRepository;
}) {
  return {
    async authorizeCompanyRequest(input: {
      readonly companyId: string;
      readonly capability: Capability;
    }): Promise<CompanyRequestAuthorization> {
      const session = await dependencies.loadSession();
      return authorizeCompanyRequestWithSession(
        session?.user?.idpSubject
          ? { user: { idpSubject: session.user.idpSubject } }
          : null,
        dependencies.repository,
        input,
      );
    },

    async loadCurrentLedgerAuthorization() {
      const session = await dependencies.loadSession();
      if (!session?.user?.idpSubject) return null;
      return dependencies.repository.load({
        subject: session.user.idpSubject,
      });
    },

    loadLedgerAuthorizationForSubject(subject: string | null) {
      return dependencies.repository.load({ subject });
    },

    recordLedgerAuthorizationFailure(
      input: Parameters<AuthorizationRepository["recordAuthorizationFailure"]>[0],
    ) {
      return dependencies.repository.recordAuthorizationFailure(input);
    },
  };
}

const serverAuthorization = createServerAuthorizationEntrypoints({
  loadSession: loadProductionSession,
  repository: authorizationRepository,
});

/**
 * Secure DAL entry point for every company-scoped Route Handler or Server
 * Action. Call it immediately before the scoped query/mutation and return
 * `result.response` when `ok` is false.
 */
export async function authorizeCompanyRequest(input: {
  readonly companyId: string;
  readonly capability: Capability;
}): Promise<CompanyRequestAuthorization> {
  return serverAuthorization.authorizeCompanyRequest(input);
}

export async function loadCurrentLedgerAuthorization() {
  return serverAuthorization.loadCurrentLedgerAuthorization();
}

/** Route handlers already holding a verified OIDC subject use this DB-backed lookup. */
export async function loadLedgerAuthorizationForSubject(
  subject: string | null,
) {
  return serverAuthorization.loadLedgerAuthorizationForSubject(subject);
}

export async function recordLedgerAuthorizationFailure(
  input: Parameters<
    typeof authorizationRepository.recordAuthorizationFailure
  >[0],
) {
  return serverAuthorization.recordLedgerAuthorizationFailure(input);
}

export function createProductionUserAdminService() {
  return createUserAdminService({
    database: db as unknown as NodePgDatabase<typeof schema>,
    keycloak: keycloakUserAdminFromEnvironment(),
  });
}
