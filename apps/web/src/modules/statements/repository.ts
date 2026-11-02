import { getTableColumns, and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { statementFiltersSchema } from "@smp/contracts/statements";
import { db } from "@smp/db";
import * as schema from "@smp/db/schema";
import { company, person, statement, statementLine, vendorAccount, licenseType } from "@smp/db/schema";
import { permittedCompanyIds } from "@smp/domain/identity-access";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { createRegisterRepository } from "../register/repository";

type Database = NodePgDatabase<typeof schema>;

const { licenseAssignment, closeRun } = schema;

export function statementCompanyIds(authorization: LedgerAuthorization | null) {
  if (!authorization) throw new Error("STATEMENTS_ACCESS_FORBIDDEN");
  const permitted = permittedCompanyIds(authorization, "finance:read");
  const ids = authorization.companyIds.filter(id => permitted === "all" || permitted.has(id));
  if (!ids.length) throw new Error("STATEMENTS_ACCESS_FORBIDDEN");
  return ids;
}

/** One repeatable snapshot keeps amounts, line evidence and run metadata consistent during reruns. */
export function createStatementRepository(database: NodePgDatabase<typeof schema>) {
  return { async read(authorization: LedgerAuthorization | null, input: unknown) {
    const ids = statementCompanyIds(authorization);
    const filters = statementFiltersSchema.parse(input);
    if (filters.companyId && !ids.includes(filters.companyId)) throw new Error("STATEMENTS_ACCESS_FORBIDDEN");
    const visibleIds = filters.companyId ? [filters.companyId] : ids;
    return database.transaction(async tx => {
      const companies = await tx.select({ id: company.id, code: company.code, name: company.name })
        .from(company).where(inArray(company.id, ids)).orderBy(asc(company.code));
      const scope = and(inArray(statement.companyId, visibleIds), eq(statement.period, filters.period),
        filters.status ? eq(statement.status, filters.status) : undefined);
      const statements = await tx.select({ statement, companyCode: company.code, companyName: company.name })
        .from(statement).innerJoin(company, and(eq(company.id, statement.companyId), inArray(company.id, visibleIds)))
        .where(scope).orderBy(asc(company.code), asc(statement.id));
      const lines = await tx.select({ statementId: statement.id, line: statementLine,
        startedOn: licenseAssignment.startedOn, endedOn: licenseAssignment.endedOn })
        .from(statementLine).innerJoin(statement, eq(statement.id, statementLine.statementId))
        .leftJoin(licenseAssignment, and(eq(licenseAssignment.id, statementLine.assignmentId), eq(licenseAssignment.companyId, statement.companyId), inArray(licenseAssignment.companyId, visibleIds)))
        .where(and(scope, eq(statementLine.kind, "license")))
        .orderBy(asc(statementLine.periodFrom), asc(statementLine.id));
      const [totals] = await tx.select({ generated: sql<number>`count(*)::int`,
        draft: sql<number>`count(*) FILTER (WHERE ${statement.status}='draft')::int`,
        final: sql<number>`count(*) FILTER (WHERE ${statement.status}='final')::int`,
        reconciled: sql<number>`count(*) FILTER (WHERE ${statement.status}='reconciled')::int`,
        totalUsd: sql<string>`COALESCE(SUM(${statement.totalUsd}),0)::numeric(30,2)::text` })
        .from(statement).where(scope);
      // CloseRun is global. Company Finance can see only runs evidenced by its statements,
      // with no operator note (which may mention other companies). Operators can also see
      // their own failed/empty runs, whose transaction produced no statement stamp.
      const global = authorization!.globalRole !== null;
      const [latest] = await tx.select({ id: closeRun.id, status: closeRun.status, startedAt: closeRun.startedAt, period: closeRun.period, finishedAt: closeRun.finishedAt, note: global ? closeRun.note : sql<string | null>`NULL` })
        .from(closeRun).where(and(eq(closeRun.period, filters.period), or(
          global ? eq(closeRun.triggeredBy, authorization!.userAccountId) : sql`false`,
          sql`EXISTS (SELECT 1 FROM ${statement} WHERE ${statement.closeRunId}=${closeRun.id} AND ${inArray(statement.companyId, visibleIds)} AND ${statement.period}=${filters.period})`,
        ))).orderBy(desc(closeRun.startedAt), desc(closeRun.id)).limit(1);
      const rows = statements.map(({statement: row, ...companyFields}) => {
        const evidence = lines.filter(l => l.statementId === row.id);
        const movements = (kind: "startedOn" | "endedOn") => {
          const seen = new Set<string>();
          return evidence.flatMap(({line, ...dates}) => {
            const date = dates[kind];
            // Do not mistake rate splits or clipped month boundaries for register movements.
            if (!date || date.slice(0, 7) !== row.period ||
              date !== (kind === "startedOn" ? line.periodFrom : line.periodTo) || seen.has(line.assignmentId!)) return [];
            seen.add(line.assignmentId!);
            return [{ assignmentId: line.assignmentId!, personId: line.personId, date }];
          });
        };
        return { ...row, ...companyFields, seatDays: evidence.reduce((sum, {line}) => sum + (line.licenseDays ?? 0), 0),
          rates: [...new Set(evidence.flatMap(({line}) => line.rateUsd === null ? [] : [line.rateUsd]))],
          joiners: movements("startedOn"), leavers: movements("endedOn") };
      });
      return { period: filters.period, companies, rows, totals: totals!, latest: (latest as typeof latest | undefined) ?? null };
    }, { isolationLevel: "repeatable read" });
  } };
}

export type StatementRegister = Awaited<ReturnType<ReturnType<typeof createStatementRepository>["read"]>>;


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
