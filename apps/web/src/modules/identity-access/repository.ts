import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  company,
  companyRoleAssignment,
  identityProviderOperation,
  person,
  userAccount,
} from "@smp/db/schema";
import * as schema from "@smp/db/schema";

import type {
  LedgerGlobalRole,
  LedgerSessionUser,
  LedgerUiLanguage,
} from "@/lib/auth/auth-types";
import { insertAuthAudit } from "../audit/auth-events";
import { withAudit } from "../audit/with-audit";
import { createAuthorizationRepository } from "./authorization";

export type IdentityLinkErrorCode =
  | "account_disabled"
  | "ambiguous_email"
  | "audit_unavailable"
  | "missing_identity_claim"
  | "provider_callback_failed"
  | "subject_conflict"
  | "unknown_account"
  | "unverified_email";

export class IdentityLinkError extends Error {
  constructor(
    readonly code: IdentityLinkErrorCode,
    readonly actorUserId: string | null = null,
  ) {
    super(`OIDC login rejected: ${code}`);
    this.name = "IdentityLinkError";
  }
}

export interface CompleteOidcLoginInput {
  readonly provider: "keycloak";
  readonly subject: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly loginAt: Date;
}

export interface LoadSessionUserInput {
  readonly subject: string;
  readonly name: string;
}

type Database = NodePgDatabase<typeof schema>;
export type IdentityAccessDatabase = Database;
type AccountRow = {
  id: string;
  email: string;
  globalRole: LedgerGlobalRole | null;
  idpSubject: string | null;
  lastLoginAt: Date | null;
  personId: string | null;
  status: "active" | "disabled";
  uiLanguage: LedgerUiLanguage | null;
};

const accountSelection = {
  id: userAccount.id,
  email: userAccount.email,
  globalRole: userAccount.globalRole,
  idpSubject: userAccount.idpSubject,
  lastLoginAt: userAccount.lastLoginAt,
  personId: userAccount.personId,
  status: userAccount.status,
  uiLanguage: userAccount.uiLanguage,
};

function assertUsableAccount(account: AccountRow): AccountRow {
  if (account.status !== "active") {
    throw new IdentityLinkError("account_disabled", account.id);
  }
  return account;
}

export function createIdentityAccessRepository(database: Database) {
  const authorizationRepository = createAuthorizationRepository(database);
  return {
    async completeOidcLogin(
      input: CompleteOidcLoginInput,
    ): Promise<AccountRow> {
      let actorUserId: string | null = null;
      let result: AccountRow;
      try {
        if (!input.subject.trim() || !input.email.trim()) {
          throw new IdentityLinkError("missing_identity_claim");
        }
        if (!input.emailVerified) {
          throw new IdentityLinkError("unverified_email");
        }

        result = await withAudit(database, async (transaction) => {
          let [account] = await transaction
            .select(accountSelection)
            .from(userAccount)
            .where(eq(userAccount.idpSubject, input.subject))
            .limit(1)
            .for("update");

          if (!account) {
            const normalizedMatches = await transaction
              .select(accountSelection)
              .from(userAccount)
              .where(
                sql`lower(${userAccount.email}) = lower(${input.email.trim()})`,
              )
              .orderBy(asc(userAccount.id))
              .for("update");
            if (normalizedMatches.length > 1) {
              throw new IdentityLinkError("ambiguous_email");
            }
            [account] = normalizedMatches;
          }
          if (!account) {
            throw new IdentityLinkError("unknown_account");
          }
          actorUserId = account.id;
          assertUsableAccount(account);
          const before = {
            idp_subject: account.idpSubject,
            last_login_at: account.lastLoginAt,
          };

          if (
            account.idpSubject !== null &&
            account.idpSubject !== input.subject
          ) {
            throw new IdentityLinkError("subject_conflict", account.id);
          }

          if (account.idpSubject === null) {
            const linked = await transaction
              .update(userAccount)
              .set({ idpSubject: input.subject })
              .where(
                and(
                  eq(userAccount.id, account.id),
                  isNull(userAccount.idpSubject),
                ),
              )
              .returning({ id: userAccount.id });

            if (linked.length === 0) {
              const [racedAccount] = await transaction
                .select(accountSelection)
                .from(userAccount)
                .where(eq(userAccount.id, account.id))
                .limit(1)
                .for("update");
              if (racedAccount?.idpSubject !== input.subject) {
                throw new IdentityLinkError("subject_conflict", account.id);
              }
              account = racedAccount;
            } else {
              account = { ...account, idpSubject: input.subject };
            }
          }

          await transaction
            .update(userAccount)
            .set({ lastLoginAt: input.loginAt })
            .where(eq(userAccount.id, account.id));
          const [actorPerson] = account.personId
            ? await transaction
                .select({ companyId: person.companyId })
                .from(person)
                .where(eq(person.id, account.personId))
                .limit(1)
            : [];
          return {
            value: account,
            audit: {
              actorUserId: account.id,
              action: "authentication.oidc.succeeded",
              entityType: "UserAccount",
              entityId: account.id,
              companyId: actorPerson?.companyId ?? null,
              note: null,
              before,
              after: {
                idp_subject: input.subject,
                last_login_at: input.loginAt,
              },
            },
          };
        }, { occurredAt: input.loginAt });
      } catch (cause) {
        const error =
          cause instanceof IdentityLinkError
            ? cause
            : new IdentityLinkError("provider_callback_failed", actorUserId);
        try {
          await insertAuthAudit(database, {
            actorUserId: error.actorUserId ?? actorUserId,
            action: "authentication.oidc.failed",
            errorCode: error.code,
            occurredAt: input.loginAt,
            provider: input.provider,
          });
        } catch {
          throw new IdentityLinkError("audit_unavailable", actorUserId);
        }
        throw error;
      }
      return result;
    },

    async loadSessionUser({
      subject,
      name,
    }: LoadSessionUserInput): Promise<LedgerSessionUser | null> {
      const [account] = await database
        .select(accountSelection)
        .from(userAccount)
        .where(eq(userAccount.idpSubject, subject))
        .limit(1);
      if (!account || account.status !== "active" || !account.idpSubject) {
        return null;
      }

      const authorization = await authorizationRepository.load({
        subject,
      });
      if (!authorization) return null;

      return {
        id: account.id,
        idpSubject: account.idpSubject,
        email: account.email,
        name: name.trim() || account.email,
        globalRole: account.globalRole,
        companyGrants: authorization.companyGrants,
        employeeCompanyId: authorization.employeeCompanyId,
        roles: authorization.roles,
        companyIds: authorization.companyIds,
        uiLanguage: account.uiLanguage,
      };
    },
  };
}

export type IdentityAccessRepository = ReturnType<
  typeof createIdentityAccessRepository
>;

export type CompanyRole = "approver" | "finance" | "viewer";
export type GlobalRole = "group_admin" | "central_finance" | null;

export function createUserAdministrationRepository(database: Database) {
  return {
    async findUserByEmail(email: string) {
      const [account] = await database.select({ id: userAccount.id, idpSubject: userAccount.idpSubject })
        .from(userAccount).where(eq(userAccount.email, email)).limit(1);
      return account ?? null;
    },
    async resolveUserTarget(userAccountId: string) {
      const [target] = await database.select({
        companyId: person.companyId,
        id: userAccount.id,
        idpSubject: userAccount.idpSubject,
        status: userAccount.status,
      }).from(userAccount).leftJoin(person, eq(userAccount.personId, person.id))
        .where(eq(userAccount.id, userAccountId)).limit(1);
      return target?.idpSubject ? { ...target, idpSubject: target.idpSubject } : null;
    },
    async listUsers(companyIds: readonly string[]) {
      return database
        .select({
          id: userAccount.id,
          email: userAccount.email,
          globalRole: userAccount.globalRole,
          idpSubject: userAccount.idpSubject,
          lastLoginAt: userAccount.lastLoginAt,
          linkedPerson: person.fullName,
          personId: userAccount.personId,
          companyId: person.companyId,
          status: userAccount.status,
        })
        .from(userAccount)
        .leftJoin(person, eq(userAccount.personId, person.id))
        .where(and(
          sql`${userAccount.idpSubject} IS NOT NULL`,
          or(isNull(person.companyId), inArray(person.companyId, [...companyIds])),
        ))
        .orderBy(asc(userAccount.email));
    },

    async listCompanyRoles(companyIds: readonly string[]) {
      return database
        .select({
          id: companyRoleAssignment.id,
          userAccountId: companyRoleAssignment.userAccountId,
          userEmail: userAccount.email,
          companyId: companyRoleAssignment.companyId,
          companyName: company.name,
          role: companyRoleAssignment.role,
          validFrom: companyRoleAssignment.validFrom,
          validTo: companyRoleAssignment.validTo,
        })
        .from(companyRoleAssignment)
        .innerJoin(userAccount, eq(companyRoleAssignment.userAccountId, userAccount.id))
        .innerJoin(company, eq(companyRoleAssignment.companyId, company.id))
        .where(inArray(companyRoleAssignment.companyId, [...companyIds]))
        .orderBy(asc(userAccount.email), asc(company.name), asc(companyRoleAssignment.role));
    },

    async listCompanies(companyIds: readonly string[]) {
      return database
        .select({ id: company.id, name: company.name })
        .from(company)
        .where(and(eq(company.status, "active"), inArray(company.id, [...companyIds])))
        .orderBy(asc(company.name));
    },

    async listAvailablePeople(companyIds: readonly string[]) {
      return database
        .select({ id: person.id, fullName: person.fullName })
        .from(person)
        .leftJoin(userAccount, eq(userAccount.personId, person.id))
        .where(and(
          eq(person.status, "active"),
          isNull(userAccount.id),
          inArray(person.companyId, [...companyIds]),
        ))
        .orderBy(asc(person.fullName));
    },

    async createUserAccount(input: {
      actorUserId: string;
      email: string;
      globalRole: GlobalRole;
      idpSubject: string;
      note: string;
      operationId: string;
      operationCompanyId: string | null;
      leaseToken: string;
      personId: string | null;
      permittedCompanyIds: readonly string[];
      occurredAt: Date;
    }) {
      return withAudit(database, async (transaction) => {
        const [claimedOperation] = await transaction.select({ id: identityProviderOperation.id })
          .from(identityProviderOperation)
          .where(and(
            eq(identityProviderOperation.id, input.operationId),
            sql`${identityProviderOperation.companyId} IS NOT DISTINCT FROM ${input.operationCompanyId}`,
            eq(identityProviderOperation.leaseToken, input.leaseToken),
            eq(identityProviderOperation.status, "provider_applied"),
          ))
          .limit(1);
        if (!claimedOperation) throw new Error("provider_operation_not_claimed");
        const [linkedPerson] = input.personId
          ? await transaction
              .select({ companyId: person.companyId })
              .from(person)
              .where(and(
                eq(person.id, input.personId),
                inArray(person.companyId, [...input.permittedCompanyIds]),
              ))
              .limit(1)
          : [];
        if (input.personId && !linkedPerson) throw new Error("cross_company_target");
        const [created] = await transaction
          .insert(userAccount)
          .values({
            createdAt: input.occurredAt,
            createdBy: input.actorUserId,
            email: input.email,
            globalRole: input.globalRole,
            idpSubject: input.idpSubject,
            personId: input.personId,
            status: "active",
          })
          .returning({ id: userAccount.id, idpSubject: userAccount.idpSubject });
        if (!created) throw new Error("user_create_failed");
        const [completedOperation] = await transaction.update(identityProviderOperation).set({
          completedAt: input.occurredAt,
          leaseExpiresAt: null,
          leaseToken: null,
          nextRetryAt: null,
          status: "completed",
        }).where(and(
          eq(identityProviderOperation.id, input.operationId),
          sql`${identityProviderOperation.companyId} IS NOT DISTINCT FROM ${input.operationCompanyId}`,
          eq(identityProviderOperation.leaseToken, input.leaseToken),
          eq(identityProviderOperation.status, "provider_applied"),
        )).returning({ id: identityProviderOperation.id });
        if (!completedOperation) throw new Error("provider_operation_not_claimed");
        return {
          value: created,
          audit: {
            actorUserId: input.actorUserId,
            action: "identity.user.created",
            entityType: "UserAccount",
            entityId: created.id,
            companyId: linkedPerson?.companyId ?? null,
            note: input.note,
            before: null,
            after: { email: input.email, globalRole: input.globalRole, idpSubject: input.idpSubject, personId: input.personId },
          },
        };
      }, { occurredAt: input.occurredAt });
    },

    async finalizeUserMutation(input: {
      action: "identity.user.disabled" | "identity.user.two_factor_reset";
      actorUserId: string;
      companyId: string | null;
      note: string;
      operationId: string;
      leaseToken: string;
      occurredAt: Date;
      statusBefore: "active" | "disabled";
      userAccountId: string;
    }) {
      return withAudit(database, async (transaction) => {
        const [claimedOperation] = await transaction.select({ id: identityProviderOperation.id })
          .from(identityProviderOperation)
          .where(and(
            eq(identityProviderOperation.id, input.operationId),
            sql`${identityProviderOperation.companyId} IS NOT DISTINCT FROM ${input.companyId}`,
            eq(identityProviderOperation.leaseToken, input.leaseToken),
            eq(identityProviderOperation.status, "provider_applied"),
          ))
          .limit(1);
        if (!claimedOperation) throw new Error("provider_operation_not_claimed");
        if (input.action === "identity.user.disabled") {
          await transaction.update(userAccount).set({ status: "disabled" }).where(eq(userAccount.id, input.userAccountId));
        }
        const [completedOperation] = await transaction.update(identityProviderOperation).set({
          completedAt: input.occurredAt,
          leaseExpiresAt: null,
          leaseToken: null,
          nextRetryAt: null,
          status: "completed",
        }).where(and(
          eq(identityProviderOperation.id, input.operationId),
          sql`${identityProviderOperation.companyId} IS NOT DISTINCT FROM ${input.companyId}`,
          eq(identityProviderOperation.leaseToken, input.leaseToken),
          eq(identityProviderOperation.status, "provider_applied"),
        )).returning({ id: identityProviderOperation.id });
        if (!completedOperation) throw new Error("provider_operation_not_claimed");
        return {
          value: { id: input.userAccountId },
          audit: {
            actorUserId: input.actorUserId,
            action: input.action,
            entityType: "UserAccount",
            entityId: input.userAccountId,
            companyId: input.companyId,
            note: input.note,
            before: { status: input.statusBefore },
            after: input.action === "identity.user.disabled" ? { status: "disabled" } : { twoFactorStatus: "pending" },
          },
        };
      }, { occurredAt: input.occurredAt });
    },

    async grantCompanyRole(input: {
      actorUserId: string;
      companyId: string;
      note: string;
      occurredAt: Date;
      role: CompanyRole;
      userAccountId: string;
      validFrom: string | null;
      validTo: string | null;
    }) {
      return withAudit(database, async (transaction) => {
        const [targetCompany] = await transaction.select({ id: company.id }).from(company).where(eq(company.id, input.companyId)).limit(1);
        const [targetUser] = await transaction.select({ id: userAccount.id }).from(userAccount).where(eq(userAccount.id, input.userAccountId)).limit(1);
        if (!targetCompany || !targetUser) throw new Error("cross_company_target");
        const [created] = await transaction.insert(companyRoleAssignment).values({
          companyId: input.companyId,
          createdAt: input.occurredAt,
          createdBy: input.actorUserId,
          role: input.role,
          uniqueGrant: `${input.userAccountId}:${input.companyId}:${input.role}`,
          userAccountId: input.userAccountId,
          validFrom: input.validFrom,
          validTo: input.validTo,
        }).returning({ id: companyRoleAssignment.id });
        if (!created) throw new Error("role_grant_failed");
        return {
          value: created,
          audit: {
            actorUserId: input.actorUserId,
            action: "identity.company_role.granted",
            entityType: "CompanyRoleAssignment",
            entityId: created.id,
            companyId: input.companyId,
            note: input.note,
            before: null,
            after: { role: input.role, userAccountId: input.userAccountId, validFrom: input.validFrom, validTo: input.validTo },
          },
        };
      }, { occurredAt: input.occurredAt });
    },

    async removeCompanyRole(input: {
      actorUserId: string;
      roleAssignmentId: string;
      permittedCompanyIds: readonly string[];
      note: string;
    }) {
      return database.transaction(async (transaction) => {
        const [assignment] = await transaction.select({ companyId: companyRoleAssignment.companyId })
          .from(companyRoleAssignment).where(and(
            eq(companyRoleAssignment.id, input.roleAssignmentId),
            inArray(companyRoleAssignment.companyId, [...input.permittedCompanyIds]),
          )).limit(1);
        if (!assignment) return null;
        const result = await transaction.execute(sql`
          SELECT id, user_account_id, company_id, role, unique_grant
          FROM public.revoke_company_role_assignment(
            ${input.roleAssignmentId}::uuid,
            ${assignment.companyId}::uuid,
            ${input.actorUserId}::uuid,
            ${input.note}::text
          )
        `);
        return result.rows[0] ?? null;
      });
    },
  };
}
