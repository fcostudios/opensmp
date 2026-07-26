import {
  and,
  asc,
  eq,
  isNull,
  sql,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { userAccount } from "@smp/db/schema";
import * as schema from "@smp/db/schema";

import type {
  LedgerGlobalRole,
  LedgerSessionUser,
  LedgerUiLanguage,
} from "@/lib/auth/auth-types";
import { insertAuthAudit } from "../audit/auth-events";
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
type AccountRow = {
  id: string;
  email: string;
  globalRole: LedgerGlobalRole | null;
  idpSubject: string | null;
  status: "active" | "disabled";
  uiLanguage: LedgerUiLanguage | null;
};

const accountSelection = {
  id: userAccount.id,
  email: userAccount.email,
  globalRole: userAccount.globalRole,
  idpSubject: userAccount.idpSubject,
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

        result = await database.transaction(async (transaction) => {
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
          await insertAuthAudit(transaction, {
            actorUserId: account.id,
            action: "authentication.oidc.succeeded",
            errorCode: "none",
            occurredAt: input.loginAt,
            provider: input.provider,
          });
          return account;
        });
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
