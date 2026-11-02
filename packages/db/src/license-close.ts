import { createHash } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
const { company, statement, statementLine, closeRun, licenseAssignment, rateCard, vendorAccount } = schema;
type Database = NodePgDatabase<typeof schema>;
type Assignment = typeof licenseAssignment.$inferSelect;
type Rate = typeof rateCard.$inferSelect;
type Line = Pick<typeof statementLine.$inferInsert, "personId" | "vendorAccountId" | "licenseTypeId" | "assignmentId" | "licenseDays" | "rateUsd" | "amountUsd" | "periodFrom" | "periodTo" | "note"> & { companyId:string };
export type LicenseClosePolicy = {
  monthBounds(period:string): {from:string;to:string;days:number};
  computeLicenseClose(period:string, assignments:readonly Assignment[], rates:readonly Rate[]): Line[];
};
function lineId(key:string) {
  const hash=createHash("sha256").update(key).digest("hex");
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
}
/** Shared manual/scheduled persistence. The caller validates authorization and command. */
export function createLicenseCloseRepository(database:Database, {monthBounds,computeLicenseClose}:LicenseClosePolicy) {
  return { async runClose(authorization:{userAccountId:string;companyIds:readonly string[]}, command:{period:string;note:string|null}, now:()=>Date) {
        const month = monthBounds(command.period);
        const startedAt = now();
        const audit = (run: typeof closeRun.$inferSelect) => ({ actorUserId: authorization.userAccountId,
          action: `close.${run.status}`, entityType: "CloseRun", entityId: run!.id,
          companyId: null, note: run.note, before: null, after: run });
        const run = await database.transaction(async tx => {
        const [run] = await tx.insert(closeRun).values({ period: command.period, status: "running",
          startedAt, createdAt: startedAt, triggeredBy: authorization.userAccountId, note: command.note }).returning();
        await tx.insert(schema.auditLog).values({ ...audit(run!), action: "close.started", occurredAt: startedAt });
        return run!;
        });
        try {
          return await database.transaction(async tx => {
            // Same-period reruns serialize before reading any draft or register input.
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'license-close:' + command.period}, 0))`);
            const companies = await tx.select().from(company).where(and(inArray(company.id, [...authorization.companyIds]), eq(company.status, "active"))).orderBy(asc(company.id));
            const ids = companies.map(c => c.id);
            const existing = await tx.select().from(statement).where(and(inArray(statement.companyId, ids), eq(statement.period, command.period))).orderBy(asc(statement.id)).for("update");
            const assignments = await tx.select().from(licenseAssignment).where(and(inArray(licenseAssignment.companyId, ids), lte(licenseAssignment.startedOn, month.to), or(isNull(licenseAssignment.endedOn), gte(licenseAssignment.endedOn, month.from))));
            const accountIds = [...new Set(assignments.map(a => a.vendorAccountId))];
            // Same lock order as US-032's rate edits and finalization triggers.
            // @equivalent: the projection is unused; an empty projection locks the same account rows.
            await tx.select({ id: vendorAccount.id }).from(vendorAccount).where(inArray(vendorAccount.id, accountIds)).orderBy(asc(vendorAccount.id)).for("no key update");
            const rates = await tx.select().from(rateCard).where(and(inArray(rateCard.vendorAccountId, accountIds), lte(rateCard.effectiveFrom, month.to), or(isNull(rateCard.effectiveTo), gte(rateCard.effectiveTo, month.from))));
            const lines = computeLicenseClose(command.period, assignments, rates);
            for (const c of companies) {
              const previous = existing.find(s => s.companyId === c.id);
              if (previous && previous.status !== "draft") continue;
              const openingSeats = assignments.filter(a => a.companyId === c.id && a.startedOn <= month.from).length;
              const [target] = previous ? [previous] : await tx.insert(statement).values({ companyId: c.id, period: command.period, status: "draft", openingSeats: 0, totalUsd: "0.00", generatedAt: startedAt, createdAt: startedAt, closeRunId: run!.id }).returning();
              // Parent row remains locked through replacement; every child mutation is company-scoped through that parent.
              await tx.execute(sql`SELECT public.clear_draft_license_lines(${target!.id}::uuid, ${c.id}::uuid, ${authorization.userAccountId}::uuid)`);
              const companyLines = lines.filter(l => l.companyId === c.id);
              if (companyLines.length) await tx.insert(statementLine).values(companyLines.map(({ companyId: _companyId, ...line }) => ({ ...line,
                id: lineId(`${target!.id}:${line.assignmentId}:${line.periodFrom}:${line.periodTo}`), statementId: target!.id, kind: "license" as const })));
              const [total] = await tx.select({ amount: sql<string>`COALESCE(SUM(${statementLine.amountUsd}),0)::numeric(12,2)::text` }).from(statementLine)
                .innerJoin(statement, eq(statementLine.statementId, statement.id)).where(and(eq(statement.id, target!.id), eq(statement.companyId, c.id)));
              // SUM happens in Postgres numeric; no floating point crosses the money boundary.
              const totalUsd = total!.amount;
              await tx.update(statement).set({ openingSeats, totalUsd, generatedAt: startedAt, closeRunId: run!.id })
                .where(and(eq(statement.id, target!.id), eq(statement.companyId, c.id), eq(statement.status, "draft")));
            }
            const [value] = await tx.update(closeRun).set({ status: "succeeded", finishedAt: now() }).where(eq(closeRun.id, run!.id)).returning();
            await tx.insert(schema.auditLog).values({ ...audit(value!), occurredAt: startedAt });
            return { ...value!, durationMs: value!.finishedAt!.valueOf() - value!.startedAt.valueOf() };
          });
        } catch (error) {
          const reason = error instanceof Error && error.message === "CLOSE_RATE_COVERAGE" ? error.message : "CLOSE_FAILED";
          return database.transaction(async tx => {
          const [value] = await tx.update(closeRun).set({ status: "failed", finishedAt: now(), note: [command.note, reason].filter(Boolean).join("\n") }).where(eq(closeRun.id, run!.id)).returning();
          await tx.insert(schema.auditLog).values({ ...audit(value!), occurredAt: startedAt });
          return { ...value!, durationMs: value!.finishedAt!.valueOf() - value!.startedAt.valueOf() };
          });
        }
  } };
}
