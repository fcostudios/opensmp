import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "@smp/db/schema";
import { createLicenseCloseRepository } from "@smp/db/license-close";
import { SYSTEM_USER_ID } from "@smp/db/system-ids";
import { computeLicenseClose, monthBounds } from "@smp/domain/close/license-close";
import { ecuadorOperatingDate, isThirdBusinessDay, successfulJob, type EcuadorBusinessCalendar } from "@smp/domain";

export function createScheduledCloseJob(options:{connectionString:string; calendar:EcuadorBusinessCalendar; now:()=>Date}) {
  const pool=new pg.Pool({connectionString:options.connectionString});
  // Stryker disable next-line ObjectLiteral: @equivalent No relational db.query API is used; query builders receive the concrete table objects below.
  const database=drizzle(pool,{schema});
  const repository=createLicenseCloseRepository(database,{monthBounds,computeLicenseClose});
  return {
    close:async()=>{await pool.end();},
    async run(at:Date) {
      if (!isThirdBusinessDay(at,options.calendar)) return successfulJob(0);
      const previous=new Date(`${ecuadorOperatingDate(at).slice(0,7)}-01T00:00:00Z`);
      previous.setUTCMonth(previous.getUTCMonth()-1);
      const period=previous.toISOString().slice(0,7);
      const companies=await database.select({id:schema.company.id}).from(schema.company).where(eq(schema.company.status,"active"));
      const run=await repository.runClose({userAccountId:SYSTEM_USER_ID,companyIds:companies.map(c=>c.id)},{period,note:null},options.now);
      // Leave the failed CloseRun durable for both the workbench and independent alert evaluation.
      if(run.status==="failed") {
        const code="CLOSE_FAILED";
        throw Object.assign(new Error(code),{code});
      }
      return successfulJob(1);
    },
  };
}
