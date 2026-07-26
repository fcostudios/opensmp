import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

import type { CompanyImportRow } from "@smp/contracts";
import {
  company,
  companyRoleAssignment,
  person,
  userAccount,
} from "@smp/db/schema";
import * as schema from "@smp/db/schema";

export type ImportDatabase = NodePgDatabase<typeof schema>;
export type ImportTransaction = Parameters<
  Parameters<ImportDatabase["transaction"]>[0]
>[0];

export interface CreationCounts {
  companies: number;
  contactAccounts: number;
  roleAssignments: number;
}

export async function importCompanies(
  transaction: ImportTransaction,
  rows: readonly CompanyImportRow[],
  actorUserId: string,
  occurredAt: Date,
): Promise<CreationCounts> {
  const counts: CreationCounts = {
    companies: 0,
    contactAccounts: 0,
    roleAssignments: 0,
  };

  for (const row of rows) {
    let [companyRow] = await transaction
      .select()
      .from(company)
      .where(eq(company.code, row.code))
      .limit(1);
    if (!companyRow) {
      [companyRow] = await transaction
        .insert(company)
        .values({
          code: row.code,
          name: row.name,
          type: row.type,
          status: "active",
          budgetMonthlyUsd: row.budgetMonthlyUsd,
          financeContactEmail: row.financeContactEmail,
          statementLanguage: row.statementLanguage,
          createdAt: occurredAt,
          createdBy: actorUserId,
        })
        .returning();
      counts.companies += 1;
    }

    const contacts = [
      { email: row.approverEmail, role: "approver" as const },
      { email: row.financeContactEmail, role: "finance" as const },
    ];
    for (const contact of contacts) {
      let [account] = await transaction
        .select()
        .from(userAccount)
        .where(eq(userAccount.email, contact.email))
        .limit(1);
      if (!account) {
        [account] = await transaction
          .insert(userAccount)
          .values({
            email: contact.email,
            status: "disabled",
            createdAt: occurredAt,
            createdBy: actorUserId,
          })
          .returning();
        counts.contactAccounts += 1;
      }
      if (account.personId) {
        const [linkedPerson] = await transaction
          .select({ companyId: person.companyId })
          .from(person)
          .where(eq(person.id, account.personId))
          .limit(1);
        if (linkedPerson && linkedPerson.companyId !== companyRow.id) {
          throw new Error(
            `Contact ${contact.email} conflicts with an identity in another company`,
          );
        }
      }
      const [grant] = await transaction
        .select({ id: companyRoleAssignment.id })
        .from(companyRoleAssignment)
        .where(eq(
          companyRoleAssignment.uniqueGrant,
          `${account.id}:${companyRow.id}:${contact.role}`,
        ))
        .limit(1);
      if (!grant) {
        await transaction.insert(companyRoleAssignment).values({
          userAccountId: account.id,
          companyId: companyRow.id,
          role: contact.role,
          uniqueGrant: `${account.id}:${companyRow.id}:${contact.role}`,
          createdAt: occurredAt,
          createdBy: actorUserId,
        });
        counts.roleAssignments += 1;
      }
    }
  }
  return counts;
}
