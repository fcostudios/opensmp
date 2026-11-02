import { getTableColumns, and, asc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { db } from "@smp/db";
import * as schema from "@smp/db/schema";
import { company, person, statement, statementLine, vendorAccount, licenseType } from "@smp/db/schema";
import { permittedCompanyIds } from "@smp/domain/identity-access";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { createRegisterRepository } from "../register/repository";

type Database = NodePgDatabase<typeof schema>;

/** Read contract for SCR-statement-detail; license evidence is the US-033 projection. */
export function createStatementDetailRepository(database: Database) {
  return {
    async find(authorization: LedgerAuthorization, statementId: string) {
      if (!z.string().uuid().safeParse(statementId).success) return null;
      return database.transaction(async (transaction) => {
        const register = createRegisterRepository(transaction);
        const scope = permittedCompanyIds(authorization, "finance:read");
        const [header] = await transaction.select({ statement, companyName: company.name, companyCode: company.code })
          .from(statement).innerJoin(company, eq(company.id, statement.companyId))
          .where(and(eq(statement.id, statementId), scope === "all" ? sql`TRUE` : inArray(statement.companyId, [...scope])));
        if (!header) return null;
        const lines = await transaction.select({
          ...getTableColumns(statementLine),
          personName: person.fullName,
          vendorAccountName: vendorAccount.name,
          licenseTypeName: licenseType.name,
        }).from(statementLine)
          .innerJoin(statement, eq(statement.id, statementLine.statementId))
          .innerJoin(vendorAccount, eq(vendorAccount.id, statementLine.vendorAccountId))
          .leftJoin(person, and(eq(person.id, statementLine.personId), eq(person.companyId, header.statement.companyId)))
          .leftJoin(licenseType, eq(licenseType.id, statementLine.licenseTypeId))
          .where(and(eq(statementLine.statementId, statementId), eq(statement.companyId, header.statement.companyId), inArray(statementLine.kind, ["license", "adjustment"])))
          .orderBy(asc(statementLine.id));
        const assignments = await register.assignmentsById(authorization, lines.flatMap(line => line.kind === "license" && line.assignmentId ? [line.assignmentId] : []));
        return { ...header, lines: lines.map(line => ({ ...line, assignment: assignments.find(row => row.id === line.assignmentId && row.companyId === header.statement.companyId) ?? null })) };
      }, {
        isolationLevel: "repeatable read",
        // Stryker disable next-line StringLiteral: @equivalent removing read-only mode leaves these SELECT-only reads unchanged; independent US-036 reviewer approved. Repeatable-read behavior is verified by the concurrent draft-rerun oracle.
        accessMode: "read only",
      });
    },
  };
}
export type StatementDetail = NonNullable<Awaited<ReturnType<ReturnType<typeof createStatementDetailRepository>["find"]>>>;
export const statementDetailRepository = createStatementDetailRepository(db as unknown as Database);
