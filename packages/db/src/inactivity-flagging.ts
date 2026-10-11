import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { applyRequestTransitionInTransaction } from "./request-transition.js";
import type * as schema from "./schema.js";

type Database = NodePgDatabase<typeof schema>;
type Candidate = Readonly<{
  assignmentId: string;
  personId: string;
  requestId: string;
  accountId: string;
  licenseId: string;
}>;

export type InactivityFlaggingPolicy = Readonly<{
  evaluateInactivity(input: Readonly<{
    evaluationDate: string;
    accountDataThrough: string | null;
    lastActivityDate: string | null;
    window: 30;
  }>): Readonly<{
    dataThrough: string;
    lastActivityDate: string | null;
    classification: "active" | "inactive" | "no_data";
  }>;
  hasPositiveVendorActivity(counters: unknown): boolean;
}>;

/** Each anchor owns its lock lifetime and its transition/audit transaction. */
export function createInactivityFlaggingRepository(database: Database, policy: InactivityFlaggingPolicy) {
  const { evaluateInactivity, hasPositiveVendorActivity } = policy;
  return {
    async runForCompany(input: {
      readonly companyId: string;
      readonly evaluationDate: string;
      readonly occurredAt: Date;
    }): Promise<number> {
      const { companyId, evaluationDate, occurredAt } = input;
      // Validate before even discovering candidates, including empty companies.
      evaluateInactivity({ evaluationDate, accountDataThrough: null, lastActivityDate: null, window: 30 });
      if (!Number.isFinite(occurredAt.getTime())) throw new Error("Invalid inactivity flagging timestamp");
      const candidates = await database.execute<Candidate>(sql`
        SELECT a.id::text AS "assignmentId", a.person_id::text AS "personId",
               a.source_request_id::text AS "requestId", a.vendor_account_id::text AS "accountId",
               a.license_type_id::text AS "licenseId"
        FROM license_assignment a
        JOIN person p ON p.id=a.person_id AND p.company_id=a.company_id
        JOIN license_request r ON r.id=a.source_request_id AND r.company_id=a.company_id
          AND r.person_id=a.person_id AND r.vendor_account_id=a.vendor_account_id
          AND r.license_type_id=a.license_type_id
        WHERE a.company_id=${companyId}::uuid AND p.company_id=${companyId}::uuid
          AND r.company_id=${companyId}::uuid AND a.ended_on IS NULL
          AND r.state IN ('active','flagged_inactive')
        ORDER BY a.person_id,a.id,r.id`);
      let processed = 0;
      for (const candidate of candidates.rows) {
        processed += await database.transaction(async tx => {
          // This mode blocks transfer but permits FK KEY SHARE checks.
          const person = await tx.execute(sql`SELECT id FROM person
            WHERE id=${candidate.personId}::uuid AND company_id=${companyId}::uuid
            FOR NO KEY UPDATE`);
          if (person.rows.length !== 1) return 0;
          const assignment = await tx.execute(sql`SELECT id FROM license_assignment
            WHERE id=${candidate.assignmentId}::uuid AND company_id=${companyId}::uuid
              AND person_id=${candidate.personId}::uuid AND ended_on IS NULL
              AND source_request_id=${candidate.requestId}::uuid
              AND vendor_account_id=${candidate.accountId}::uuid
              AND license_type_id=${candidate.licenseId}::uuid
            FOR UPDATE`);
          if (assignment.rows.length !== 1) return 0;
          const locked = await tx.execute<{ state: "active" | "flagged_inactive" }>(sql`
            SELECT state::text AS state FROM license_request
            WHERE id=${candidate.requestId}::uuid AND company_id=${companyId}::uuid
              AND person_id=${candidate.personId}::uuid AND vendor_account_id=${candidate.accountId}::uuid
              AND license_type_id=${candidate.licenseId}::uuid
              AND state IN ('active','flagged_inactive') FOR UPDATE`);
          const request = locked.rows[0];
          if (!request) return 0;
          // Both freshness and person observations share one READ COMMITTED snapshot,
          // taken after all locks. Account freshness intentionally spans all holders.
          const evidence = await tx.execute<{
            dataThrough: string | null;
            observations: { date: string; counters: unknown }[];
          }>(sql`
            SELECT (SELECT max(activity_date)::text FROM activity_record
                    WHERE vendor_account_id=${candidate.accountId}::uuid) AS "dataThrough",
                   COALESCE((SELECT jsonb_agg(jsonb_build_object('date',ar.activity_date::text,'counters',ar.counters)
                                      ORDER BY ar.activity_date DESC)
                    FROM activity_record ar JOIN person p ON p.id=ar.person_id
                    WHERE ar.vendor_account_id=${candidate.accountId}::uuid
                      AND ar.person_id=${candidate.personId}::uuid AND p.company_id=${companyId}::uuid), '[]'::jsonb) AS observations`);
          const signal = evidence.rows[0];
          const lastActivityDate = signal.observations.find(observation => hasPositiveVendorActivity(observation.counters))?.date ?? null;
          const evaluation = evaluateInactivity({ evaluationDate, accountDataThrough: signal.dataThrough, lastActivityDate, window: 30 });
          const to = request.state === "active" && evaluation.classification === "inactive"
            ? "flagged_inactive"
            : request.state === "flagged_inactive" && evaluation.classification === "active" ? "active" : null;
          if (to === null) return 0;
          await applyRequestTransitionInTransaction(tx, {
            requestId: candidate.requestId, from: request.state, to, actorUserId: null, occurredAt,
            note: `inactivityFlagging: dataThrough=${evaluation.dataThrough}; lastActivity=${evaluation.lastActivityDate}`,
          }, { expectedCompanyId: companyId });
          return 1;
        });
      }
      return processed;
    },
  };
}
