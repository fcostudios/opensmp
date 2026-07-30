import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import {
  hasCapability,
  permittedCompanyIds,
  type AuthorizationContext,
  type Capability,
} from "@smp/domain/identity-access";
import {
  auditLog,
  company,
  companyRoleAssignment,
  person,
  userAccount,
} from "@smp/db/schema";
import * as schema from "@smp/db/schema";

import type {
  LedgerCompanyGrant,
  LedgerRole,
} from "@/lib/auth/auth-types";

type Database = NodePgDatabase<typeof schema>;

export const AUTHORIZATION_SYSTEM_ENTITY_ID =
  "00000000-0000-0000-0000-000000000005";

export interface LedgerAuthorization extends AuthorizationContext {
  readonly userId: string;
  readonly roles: readonly LedgerRole[];
  readonly companyIds: readonly string[];
}

export type AuthorizationErrorCode = "capability_forbidden";

export class AuthorizationError extends Error {
  readonly status = 403;

  constructor(
    readonly code: AuthorizationErrorCode,
    readonly capability: Capability,
    readonly companyId: string,
    readonly actorUserId: string | null,
  ) {
    super();
  }
}

function ledgerRoles(
  globalRole: "group_admin" | "central_finance" | null,
  employeeCompanyId: string | null,
  grants: readonly LedgerCompanyGrant[],
): LedgerRole[] {
  const roles = new Set<LedgerRole>();
  // @equivalent: forcing this branch for null only inserts null at runtime;
  // the fixed LedgerRole allowlist below filters it out, while non-null roles
  // follow the same insertion path.
  if (globalRole) roles.add(globalRole);
  if (employeeCompanyId) roles.add("employee");
  for (const grant of grants) {
    roles.add(grant.role === "finance" ? "company_finance" : grant.role);
  }
  return [
    "group_admin",
    "central_finance",
    "employee",
    "approver",
    "company_finance",
    "viewer",
  ].filter((role): role is LedgerRole => roles.has(role as LedgerRole));
}

export function createAuthorizationRepository(database: Database) {
  return {
    async load({
      subject,
    }: {
      readonly subject: string | null;
    }): Promise<LedgerAuthorization | null> {
      const [account] = await database
        .select({
          id: userAccount.id,
          idpSubject: userAccount.idpSubject,
          globalRole: userAccount.globalRole,
          personCompanyId: person.companyId,
          status: userAccount.status,
        })
        .from(userAccount)
        .leftJoin(person, eq(userAccount.personId, person.id))
        .where(
          subject === null ? sql`false` : eq(userAccount.idpSubject, subject),
        )
        .limit(1);
      if (
        !account ||
        account.status !== "active" ||
        !account.idpSubject
      ) {
        return null;
      }

      const grants = await database
        .select({
          companyId: companyRoleAssignment.companyId,
          role: companyRoleAssignment.role,
        })
        .from(companyRoleAssignment)
        .where(
          and(
            eq(companyRoleAssignment.userAccountId, account.id),
            or(
              isNull(companyRoleAssignment.validFrom),
              lte(
                companyRoleAssignment.validFrom,
                sql`CURRENT_DATE`,
              ),
            ),
            or(
              isNull(companyRoleAssignment.validTo),
              gte(companyRoleAssignment.validTo, sql`CURRENT_DATE`),
            ),
          ),
        )
        .orderBy(
          asc(companyRoleAssignment.companyId),
          asc(companyRoleAssignment.role),
        );

      const companyIds =
        account.globalRole === "group_admin" ||
        account.globalRole === "central_finance"
          ? (
              await database
                .select({ companyId: company.id })
                .from(company)
                .orderBy(asc(company.id))
            ).map(({ companyId }) => companyId)
          : [
              ...new Set([
                ...(account.personCompanyId
                  ? [account.personCompanyId]
                  : []),
                ...grants.map(({ companyId }) => companyId),
              ]),
            ].sort();

      return {
        userId: account.id,
        userAccountId: account.id,
        idpSubject: account.idpSubject,
        globalRole: account.globalRole,
        roles: ledgerRoles(
          account.globalRole,
          account.personCompanyId,
          grants,
        ),
        companyIds,
        employeeCompanyId: account.personCompanyId,
        companyGrants: grants,
      };
    },

    async recordAuthorizationFailure({
      actorUserId,
      capability,
      companyId,
      errorCode,
    }: {
      readonly actorUserId: string | null;
      readonly capability: Capability;
      readonly companyId: string | null;
      readonly errorCode: AuthorizationErrorCode;
    }): Promise<void> {
      const [existingCompany] =
        companyId === null
          ? []
          : await database
              .select({ id: company.id })
              .from(company)
              .where(eq(company.id, companyId))
              .limit(1);
      await database.insert(auditLog).values({
        actorUserId,
        action: "authorization.denied",
        entityType: "Authorization",
        entityId: AUTHORIZATION_SYSTEM_ENTITY_ID,
        companyId: existingCompany?.id ?? null,
        before: null,
        after: existingCompany
          ? { capability, errorCode }
          : companyId === null
            ? { capability, errorCode }
            : { capability, errorCode, attemptedCompanyId: companyId },
        occurredAt: sql`CURRENT_TIMESTAMP`,
      });
    },
  };
}

export function assertCapability(
  authorization: LedgerAuthorization,
  capability: Capability,
  companyId: string,
): string {
  if (!hasCapability(authorization, capability, companyId)) {
    throw new AuthorizationError(
      "capability_forbidden",
      capability,
      companyId,
      authorization.userAccountId,
    );
  }
  return companyId;
}

export function companyScope(
  context: AuthorizationContext,
  companyIdColumn: AnyPgColumn,
  capability: Capability,
): SQL | undefined {
  const companyIds = permittedCompanyIds(context, capability);
  if (companyIds === "all") return undefined;
  const values = [...companyIds];
  return values.length === 0
    ? sql`false`
    : inArray(companyIdColumn, values);
}

export type AuthorizationRepository = ReturnType<
  typeof createAuthorizationRepository
>;

export async function authorizeCompanyDataAccess(
  repository: AuthorizationRepository,
  input: {
    readonly subject: string;
    readonly companyId: string;
    readonly capability: Capability;
  },
): Promise<LedgerAuthorization> {
  const authorization = await repository.load({ subject: input.subject });
  if (!authorization) {
    throw new AuthorizationError(
      "capability_forbidden",
      input.capability,
      input.companyId,
      null,
    );
  }
  assertCapability(
    authorization,
    input.capability,
    input.companyId,
  );
  return authorization;
}
