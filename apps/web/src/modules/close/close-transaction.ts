import { createLicenseCloseRepository } from "../../../../../packages/db/src/license-close";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, or, sql, getTableColumns } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@smp/db/schema";
import { finalizeStatementSchema, finalizeStatementsSchema, runCloseSchema } from "@smp/contracts/close";
import { computeLicenseClose, monthBounds } from "@smp/domain/close/license-close";
import { assertFinalizationAccess, finalizeStatementStatus } from "@smp/domain/close/finalization";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { withAudit, verifyRecordedAuditReceipt } from "../audit/with-audit";

const { company, statement, statementLine, closeRun, rateCard, vendorAccount } = schema;
type Database = NodePgDatabase<typeof schema>;
function access(auth: LedgerAuthorization | null): asserts auth is LedgerAuthorization {
  // @equivalent: any fallback for a missing global role remains outside this explicit allowlist.
  if (!auth || !["central_finance", "group_admin"].includes(auth.globalRole ?? "")) throw new Error("CLOSE_ACCESS_FORBIDDEN");
}
function lineId(key: string) {
  const hash = createHash("sha256").update(key).digest("hex");
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
}
export function createCloseService(database: Database, { now = () => new Date() }: { now?: () => Date } = {}) {
  async function finalize(tx: Parameters<Parameters<Database["transaction"]>[0]>[0], authorization: LedgerAuthorization, command: { period: string; statementId?: string }) {
    // Share the close job's lock and order: period → statements → vendor accounts.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'license-close:' + command.period}, 0))`);
    const rows = await tx.select().from(statement).where(and(
      inArray(statement.companyId, [...authorization.companyIds]), eq(statement.period, command.period),
      command.statementId ? eq(statement.id, command.statementId) : undefined,
    )).orderBy(asc(statement.id)).for("update");
    if (command.statementId && !rows.length) throw new Error("STATEMENT_NOT_FOUND");
    const drafts = rows.filter(row => finalizeStatementStatus(row.status) !== row.status);
    const ids = drafts.map(row => row.id);
    const lines = await tx.select({ line: statementLine }).from(statementLine)
      .innerJoin(statement, eq(statement.id, statementLine.statementId))
      .where(and(inArray(statement.id, ids), inArray(statement.companyId, [...authorization.companyIds]), eq(statementLine.kind, "license")));
    const accountIds = [...new Set(lines.map(({ line }) => line.vendorAccountId))];
    // @equivalent: the projection is unused; an empty projection locks the same account rows.
    await tx.select({ id: vendorAccount.id }).from(vendorAccount).where(inArray(vendorAccount.id, accountIds)).orderBy(asc(vendorAccount.id)).for("no key update");
    // Rate edits may have won the account lock after draft generation. Require
    // one current rate to still cover each entire dated license segment.
    const rates = await tx.select().from(rateCard).where(inArray(rateCard.vendorAccountId, accountIds));
    for (const { line } of lines) {
      if (!rates.some(rate => rate.vendorAccountId === line.vendorAccountId && rate.licenseTypeId === line.licenseTypeId &&
        rate.monthlyRateUsd === line.rateUsd &&
        // @equivalent: removing the periodFrom null check still rejects null through the ordered ISO-date comparison below.
        line.periodFrom !== null &&
        line.periodTo !== null &&
        rate.effectiveFrom <= line.periodFrom && (rate.effectiveTo === null || rate.effectiveTo >= line.periodTo))) {
        throw new Error("STATEMENT_RATES_CHANGED");
      }
    }
    const occurredAt = now();
    for (const before of drafts) {
      const [after] = await tx.update(statement).set({ status: finalizeStatementStatus(before.status) })
        .where(and(eq(statement.id, before.id), eq(statement.companyId, before.companyId), eq(statement.status, "draft"))).returning();
      await tx.insert(schema.auditLog).values({ actorUserId: authorization.userAccountId, action: "statement.finalized",
        entityType: "Statement", entityId: before.id, companyId: before.companyId, before, after, note: null, occurredAt });
    }
    return ids;
  }
  return {
    async finalizeStatement(authorization: LedgerAuthorization | null, input: unknown) {
      return withAudit(database, async tx => {
        if (!authorization) throw new Error("CLOSE_ACCESS_FORBIDDEN");
        assertFinalizationAccess(authorization.globalRole);
        const command = finalizeStatementSchema.parse(input);
        const ids = await finalize(tx, authorization, command);
        return { value: ids, audit: { actorUserId: authorization.userAccountId, action: "statements.finalization_requested",
          entityType: "StatementFinalization", entityId: lineId(`finalization:${command.period}`), companyId: null,
          before: null, after: { statementIds: ids }, note: null } };
      }, { occurredAt: now() });
    },
    async finalizeStatements(authorization: LedgerAuthorization | null, input: unknown) {
      return withAudit(database, async tx => {
        if (!authorization) throw new Error("CLOSE_ACCESS_FORBIDDEN");
        assertFinalizationAccess(authorization.globalRole);
        const command = finalizeStatementsSchema.parse(input);
        const ids = await finalize(tx, authorization, command);
        return { value: ids, audit: { actorUserId: authorization.userAccountId, action: "statements.finalization_requested",
          entityType: "StatementFinalization", entityId: lineId(`finalization:${command.period}`), companyId: null,
          before: null, after: { statementIds: ids }, note: null } };
      }, { occurredAt: now() });
    },
    async statements(authorization: LedgerAuthorization | null, period: string) {
      access(authorization);
      runCloseSchema.parse({ period });
      return database.select({ id: statement.id, companyId: statement.companyId, companyName: company.name, status: statement.status })
        .from(statement).innerJoin(company, eq(company.id, statement.companyId))
        .where(and(inArray(statement.companyId, [...authorization.companyIds]), eq(statement.period, period)))
        .orderBy(asc(company.name), asc(statement.id));
    },
    async runClose(authorization: LedgerAuthorization | null, input: unknown) {
      return withAudit(database, async tx => {
        access(authorization);
        const command = runCloseSchema.parse(input);
        const run = await createLicenseCloseRepository(database, { monthBounds, computeLicenseClose }).runClose(authorization, command, now);
        const { durationMs: _durationMs, ...after } = run;
        const receipt = await verifyRecordedAuditReceipt(tx, {
          action: `close.${run.status}`, entityType: "CloseRun", entityId: run.id,
          companyId: null, actorUserId: authorization.userAccountId, after,
        });
        return { value: run, audit: receipt };
      });
    },
    async summary(authorization: LedgerAuthorization | null, period: string) {
      access(authorization);
      runCloseSchema.parse({ period });
      const [row] = await database.select({
        generated: sql<number>`count(*)::int`,
        drafts: sql<number>`count(*) FILTER (WHERE ${statement.status}='draft')::int`,
        finals: sql<number>`count(*) FILTER (WHERE ${statement.status} IN ('final','reconciled'))::int`,
        totalUsd: sql<string>`COALESCE(sum(${statement.totalUsd}),0)::numeric(12,2)::text`,
      }).from(statement).where(and(inArray(statement.companyId,[...authorization.companyIds]),eq(statement.period,period)));
      // Stryker disable next-line ObjectLiteral: @equivalent The projection is unused; only the number of authorized active company rows is consumed.
      const companies=await database.select({id:company.id}).from(company).where(and(inArray(company.id,[...authorization.companyIds]),eq(company.status,"active")));
      return {...row!,companies:companies.length};
    },
    async latestRun(authorization: LedgerAuthorization | null, period: string) {
      access(authorization);
      runCloseSchema.parse({ period });
      const [run] = await database.select({ ...getTableColumns(closeRun), triggeredByName: schema.userAccount.email, scheduled: sql<boolean>`${closeRun.triggeredBy}='00000000-0000-0000-0000-000000000001'::uuid` }).from(closeRun).leftJoin(schema.userAccount, eq(schema.userAccount.id, closeRun.triggeredBy)).where(and(eq(closeRun.period, period), or(
        eq(closeRun.triggeredBy, authorization.userAccountId),
        eq(closeRun.triggeredBy, "00000000-0000-0000-0000-000000000001"),
        sql`EXISTS (SELECT 1 FROM statement s WHERE s.close_run_id=${closeRun.id} AND ${inArray(sql`s.company_id`, [...authorization.companyIds])})`,
      ))).orderBy(desc(closeRun.startedAt), desc(closeRun.id)).limit(1);
      return run ?? null;
    },
  };
}
