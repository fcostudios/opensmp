import {
  capacityRecoveryJobSchema,
  type CapacityRecoveryJob,
} from "@smp/contracts/capacity";
import {
  businessDaysBetween,
  type EcuadorBusinessCalendar,
} from "@smp/domain/jobs/schedule";
import pg from "pg";

export function blockedDecisionAging(
  blockedAt: Date,
  evaluatedAt: Date,
  calendar: EcuadorBusinessCalendar,
): { readonly businessDays: number; readonly escalated: boolean } {
  const businessDays = businessDaysBetween(blockedAt, evaluatedAt, calendar);
  return { businessDays, escalated: businessDays > 1 };
}

export function createCapacityRecoveryJob({
  connectionString,
  now = () => new Date(),
}: {
  readonly connectionString: string;
  readonly now?: () => Date;
}) {
  const pool = new pg.Pool({ connectionString });
  return {
    async close(): Promise<void> {
      await pool.end();
    },

    async run(input: unknown): Promise<{ readonly resumedRequestIds: string[] }> {
      const parsed = capacityRecoveryJobSchema.safeParse(input);
      if (!parsed.success) throw new Error("CAPACITY_RECOVERY_INPUT_INVALID");
      return await recover(pool, parsed.data, now());
    },
  };
}

async function recover(
  pool: pg.Pool,
  input: CapacityRecoveryJob,
  occurredAt: Date,
): Promise<{ readonly resumedRequestIds: string[] }> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ request_id: string }>(
      `SELECT recovered::text AS request_id
       FROM recover_blocked_requests_for_capacity($1,$2,$3,$4,$5,$6) recovered`,
      [
        input.capacityId,
        input.vendorAccountId,
        input.licenseTypeId,
        input.effectiveFrom,
        input.companyIds,
        occurredAt,
      ],
    );
    return { resumedRequestIds: result.rows.map((row) => row.request_id) };
  } finally {
    client.release();
  }
}
