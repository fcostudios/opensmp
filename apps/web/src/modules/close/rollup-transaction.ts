import { randomUUID } from "node:crypto";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@smp/db/schema";
import { runCloseSchema } from "@smp/contracts/close";
import { csvCell } from "@smp/domain/csv";
import { cents, dollars } from "@smp/domain/close/reconciliation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auditLog, statement, statementLine } from "@smp/db/schema";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { createStatementRepository } from "../statements/repository";
import { createReconciliationService } from "./reconciliation-transaction";
import messages from "../../../messages/en-US.json";

type Database = NodePgDatabase<typeof schema>;
function access(auth: LedgerAuthorization | null): asserts auth is LedgerAuthorization {
  if (!auth || (auth.globalRole !== "central_finance" && auth.globalRole !== "group_admin")) throw new Error("ROLLUP_FORBIDDEN");
}

/** Read both existing projections in one snapshot, including any frozen reconciliation totals. */
export function createRollupService(database: Database, now = () => new Date()) {
  async function read(auth: LedgerAuthorization | null, input: unknown) {
    access(auth);
    const { period } = runCloseSchema.parse({ period: input });
    return database.transaction(async tx => {
      // Drizzle's nested transaction uses a savepoint and inherits this outer repeatable-read snapshot.
      const snapshot = tx as unknown as Database;
      const statements = await createStatementRepository(snapshot).read(auth, { period });
      const cards = await createReconciliationService(snapshot).cards(auth, period);
      const reconciliationTotalUsd = dollars(cards.reduce((total, card) => total + cents(card.rollupAmountUsd), BigInt(0)));
      const contributions = await tx.select({ statementId: statement.id, vendorAccountId: statementLine.vendorAccountId,
        totalUsd: sql<string>`SUM(${statementLine.amountUsd})::numeric(30,2)::text` })
        .from(statementLine).innerJoin(statement, eq(statement.id, statementLine.statementId))
        .where(and(eq(statement.period, period), inArray(statement.companyId, [...auth.companyIds])))
        .groupBy(statement.id, statementLine.vendorAccountId);
      const complete = contributions.every(line => cards.some(card => card.vendorAccountId === line.vendorAccountId)) &&
        statements.rows.every(row => cents(row.totalUsd) === contributions.filter(line => line.statementId === row.id).reduce((sum, line) => sum + cents(line.totalUsd), BigInt(0)));
      const ties = statements.rows.length > 0 && statements.totals.draft === 0 && complete && statements.totals.totalUsd === reconciliationTotalUsd;
      return { statements, reconciliationTotalUsd, ties };
    }, { isolationLevel: "repeatable read" });
  }
  return {
    read,
    async exportRollupCsv(auth: LedgerAuthorization | null, input: unknown) {
      access(auth);
      const { statements } = await read(auth, input);
      const t = messages.statements;
      const records = statements.rows.map(row => [csvCell(`${row.companyCode} · ${row.companyName}`), csvCell(row.period), csvCell(row.totalUsd, true)].join(","));
      const csv = [[t.company, t.period, t.total].map(value => csvCell(value)).join(","), ...records].join("\r\n") + "\r\n";
      await database.insert(auditLog).values({ action: "rollup.export_csv", entityType: "StatementRollup", entityId: randomUUID(),
        actorUserId: auth.userAccountId, companyId: null, before: null, note: null,
        after: { period: statements.period, totalUsd: statements.totals.totalUsd, companyIds: statements.companies.map(company => company.id), statementCount: statements.rows.length }, occurredAt: now() });
      return { csv, filename: `rollup-${statements.period}.csv` };
    },
  };
}
export type Rollup = Awaited<ReturnType<ReturnType<typeof createRollupService>["read"]>>;
