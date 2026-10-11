import { evaluateInactivity, hasPositiveVendorActivity } from "@smp/domain/usage/inactivity";
import { createInactivityFlaggingRepository } from "@smp/db/inactivity-flagging";
import * as schema from "@smp/db/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

export function createInactivityFlaggingJob({ connectionString }: { readonly connectionString: string }) {
  const pool = new pg.Pool({ connectionString });
  const database = drizzle(pool, { schema });
  const repository = createInactivityFlaggingRepository(database, { evaluateInactivity, hasPositiveVendorActivity });
  return {
    async drain(at: Date): Promise<{ readonly processed: number }> {
      if (!Number.isFinite(at.getTime())) throw new Error("Invalid inactivity flagging timestamp");
      const evaluationDate = at.toISOString().slice(0, 10);
      // Company status does not remove an open assignment from daily evaluation.
      const companies = await database.select({ id: schema.company.id }).from(schema.company).orderBy(schema.company.id);
      let processed = 0;
      for (const company of companies) {
        processed += await repository.runForCompany({ companyId: company.id, evaluationDate, occurredAt: at });
      }
      return { processed };
    },
    async close(): Promise<void> { await pool.end(); },
  };
}
