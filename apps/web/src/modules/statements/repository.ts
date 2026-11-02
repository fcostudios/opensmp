import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@smp/db/schema";
import { statementFiltersSchema } from "@smp/contracts/statements";
import { permittedCompanyIds } from "@smp/domain/identity-access";
import type { LedgerAuthorization } from "../identity-access/authorization";

const { company, statement, statementLine, licenseAssignment, closeRun } = schema;
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
