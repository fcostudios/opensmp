import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@smp/db/schema";
import { reconciliationKey, saveInvoiceSchema, overrideReconciliationSchema, saveVarianceSchema, deleteVarianceSchema } from "@smp/contracts/reconciliation";
import { compareInvoice, cents, dollars } from "@smp/domain/close/reconciliation";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { withAudit } from "../audit/with-audit";
const { reconciliation: recon, reconciliationVarianceLine: variance, statement, statementLine, vendorAccount } = schema;
type Database = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Key = { period: string; vendorAccountId: string };
function access(auth: LedgerAuthorization | null): asserts auth is LedgerAuthorization {
  if (!auth || (auth.globalRole !== "central_finance" && auth.globalRole !== "group_admin")) throw new Error("RECONCILIATION_FORBIDDEN");
}

/** Group finalized statement contributions, never live register/rate data or duplicated headers. */
async function organizations(database: Database | Tx, auth: LedgerAuthorization, period: string, accountId?: string) {
  return database.select({ vendorAccountId: vendorAccount.id, name: vendorAccount.name,
    rollupAmountUsd: sql<string>`SUM(${statementLine.amountUsd})::numeric(12,2)::text`,
  }).from(statementLine).innerJoin(statement, eq(statement.id, statementLine.statementId))
    .innerJoin(vendorAccount, eq(vendorAccount.id, statementLine.vendorAccountId))
    .where(and(eq(statement.period, period), accountId ? eq(vendorAccount.id, accountId) : undefined))
    .groupBy(vendorAccount.id, vendorAccount.name)
    // A whole vendor invoice cannot be reconciled against a partial company scope or unfinished close.
    .having(sql`bool_and(${inArray(statement.companyId, [...auth.companyIds])}
      AND ${statement.status} IN ('final','reconciled')
      AND ${statement.totalUsd} = (SELECT COALESCE(SUM(check_line.amount_usd),0) FROM statement_line check_line WHERE check_line.statement_id=${statement.id}))`)
    .orderBy(asc(vendorAccount.id));
}
export function createReconciliationService(database: Database, { now = () => new Date() }: { now?: () => Date } = {}) {
  async function open(tx: Tx, auth: LedgerAuthorization, key: Key) {
    // All commands use the close/finalization lock before the org lock, then the parent row.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'license-close:' + key.period},0))`);
    // @equivalent: removing this extra lock or changing its key preserves serialization through the preceding whole-period close lock.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'reconciliation:' + key.period + ':' + key.vendorAccountId},0))`);
    const [org] = await organizations(tx, auth, key.period, key.vendorAccountId);
    if (!org) throw new Error("RECONCILIATION_SCOPE");
    await tx.insert(recon).values({ period: key.period, vendorAccountId: key.vendorAccountId, rollupAmountUsd: org.rollupAmountUsd, status: "open", createdAt: now() })
      .onConflictDoNothing();
    const [row] = await tx.select().from(recon).where(and(eq(recon.vendorAccountId, key.vendorAccountId), eq(recon.period, key.period))).for("update");
    if (row!.status !== "open") throw new Error("RECONCILIATION_IMMUTABLE");
    return { row: row!, rollupAmountUsd: org.rollupAmountUsd };
  }
  function audit(auth: LedgerAuthorization, action: string, before: unknown, after: unknown, id: string, note: string | null = null) {
    return { actorUserId: auth.userAccountId, action, entityType: "Reconciliation", entityId: id, companyId: null, before, after, note };
  }
  return {
    async cards(auth: LedgerAuthorization | null, period: string) {
      access(auth);
      reconciliationKey.shape.period.parse(period);
      const orgs = await organizations(database, auth, period);
      const rows = await database.select().from(recon).where(and(eq(recon.period, period), inArray(recon.vendorAccountId, orgs.map(o => o.vendorAccountId))));
      const lines = await database.select().from(variance).where(inArray(variance.reconciliationId, rows.map(r => r.id))).orderBy(asc(variance.id));
      return orgs.map(org => {
        const row = rows.find(r => r.vendorAccountId === org.vendorAccountId);
        return { ...row, ...org, rollupAmountUsd: row && row.status !== "open" ? row.rollupAmountUsd : org.rollupAmountUsd,
          status: row?.status ?? "open" as const, invoiceAmountUsd: row?.invoiceAmountUsd ?? null,
          lines: lines.filter(l => l.reconciliationId === row?.id) };
      });
    },
    async saveInvoiceAmount(auth: LedgerAuthorization | null, input: unknown) {
      return withAudit(database, async tx => {
        access(auth); const command = saveInvoiceSchema.parse(input);
        const { row, rollupAmountUsd } = await open(tx, auth, command);
        const { varianceUsd, withinTolerance } = compareInvoice(rollupAmountUsd, command.invoiceAmountUsd);
        const [after] = await tx.update(recon).set({ invoiceAmountUsd: command.invoiceAmountUsd, rollupAmountUsd, varianceUsd,
          status: withinTolerance ? "reconciled" : "open", updatedAt: now() }).where(eq(recon.id, row.id)).returning();
        return { value: after!, audit: audit(auth, "reconciliation.invoice_saved", row, after, row.id) };
      }, { occurredAt: now() });
    },
    async overrideReconciliation(auth: LedgerAuthorization | null, input: unknown) {
      return withAudit(database, async tx => {
        access(auth); const command = overrideReconciliationSchema.parse(input);
        const { row, rollupAmountUsd } = await open(tx, auth, command);
        if (row.invoiceAmountUsd === null) throw new Error("INVOICE_REQUIRED");
        const comparison = compareInvoice(rollupAmountUsd, row.invoiceAmountUsd);
        if (comparison.withinTolerance) throw new Error("OVERRIDE_NOT_REQUIRED");
        const [after] = await tx.update(recon).set({ status: "overridden", rollupAmountUsd, varianceUsd: comparison.varianceUsd,
          overrideNote: command.note, overriddenBy: auth.userAccountId, updatedAt: now() }).where(eq(recon.id, row.id)).returning();
        return { value: after!, audit: audit(auth, "reconciliation.overridden", row, after, row.id, command.note) };
      }, { occurredAt: now() });
    },
    async saveVarianceLine(auth: LedgerAuthorization | null, input: unknown) {
      return withAudit(database, async tx => {
        access(auth); const command = saveVarianceSchema.parse(input);
        const { row } = await open(tx, auth, command);
        const values = { cause: command.cause, detail: command.detail, registerAmountUsd: command.registerAmountUsd,
          invoiceAmountUsd: command.invoiceAmountUsd, differenceUsd: dollars(cents(command.registerAmountUsd) - cents(command.invoiceAmountUsd)), evidenceUrl: command.evidenceUrl };
        const [before] = command.lineId ? await tx.select().from(variance).where(and(eq(variance.id, command.lineId), eq(variance.reconciliationId, row.id))) : [];
        if (command.lineId && !before) throw new Error("VARIANCE_NOT_FOUND");
        const [after] = before ? await tx.update(variance).set(values).where(and(eq(variance.id, before.id), eq(variance.reconciliationId, row.id))).returning()
          : await tx.insert(variance).values({ ...values, reconciliationId: row.id, createdBy: auth.userAccountId, createdAt: now() }).returning();
        return { value: after!, audit: audit(auth, "reconciliation.variance_saved", before ?? null, after, row.id) };
      }, { occurredAt: now() });
    },
    async deleteVarianceLine(auth: LedgerAuthorization | null, input: unknown) {
      return withAudit(database, async tx => {
        access(auth); const command = deleteVarianceSchema.parse(input);
        const { row } = await open(tx, auth, command);
        const [before] = await tx.delete(variance).where(and(eq(variance.id, command.lineId), eq(variance.reconciliationId, row.id))).returning();
        if (!before) throw new Error("VARIANCE_NOT_FOUND");
        return { value: before, audit: audit(auth, "reconciliation.variance_deleted", before, null, row.id) };
      }, { occurredAt: now() });
    },
  };
}
export type ReconciliationCard = Awaited<ReturnType<ReturnType<typeof createReconciliationService>["cards"]>>[number];
