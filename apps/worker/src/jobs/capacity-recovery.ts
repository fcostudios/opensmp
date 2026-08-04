import {
  ecuadorOperatingDate,
  lockCapacityPool,
  routeProvisioningActionInTransaction,
} from "@smp/db/provisioning-routing";
import * as schema from "@smp/db/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

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

    async drain(at = now()): Promise<{ readonly processed: number }> {
      const client = await pool.connect();
      const leaseToken = crypto.randomUUID();
      try {
        await client.query("BEGIN");
        const claimed = await client.query<{
          capacity_id: string | null;
          effective_from: string;
          id: string;
          license_type_id: string;
          vendor_account_id: string;
        }>(
          `WITH candidate AS (
             SELECT id FROM capacity_recovery_work
             WHERE available_at <= $1
               AND (status = 'pending' OR (status = 'processing' AND lease_expires_at <= $1))
             ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 10
           )
           UPDATE capacity_recovery_work work
           SET status='processing', lease_token=$2, lease_expires_at=$1 + interval '5 minutes',
               attempt_count=attempt_count+1, last_error=NULL
           FROM candidate WHERE work.id=candidate.id
           RETURNING work.id::text,work.capacity_id::text,work.vendor_account_id::text,
                     work.license_type_id::text,work.effective_from::text`,
          [at, leaseToken],
        );
        await client.query("COMMIT");
        let processed = 0;
        for (const work of claimed.rows) {
          try {
            await recover(pool, {
              licenseTypeId: work.license_type_id,
              vendorAccountId: work.vendor_account_id,
            }, at);
            const completed = await pool.query(
              `UPDATE capacity_recovery_work SET status='completed',completed_at=$3,
                 lease_token=NULL,lease_expires_at=NULL
               WHERE id=$1 AND lease_token=$2 RETURNING id`,
              [work.id, leaseToken, at],
            );
            if (completed.rowCount === 1) processed += 1;
          } catch (error) {
            await pool.query(
              `UPDATE capacity_recovery_work SET status='pending',last_error=$3,
                 lease_token=NULL,lease_expires_at=NULL
               WHERE id=$1 AND lease_token=$2`,
              [work.id, leaseToken, String(error)],
            );
            throw error;
          }
        }
        return { processed };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

async function recover(
  pool: pg.Pool,
  input: {
    readonly licenseTypeId: string;
    readonly vendorAccountId: string;
  },
  occurredAt: Date,
): Promise<{ readonly resumedRequestIds: string[] }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const database = drizzle(client, { schema });
    await lockCapacityPool(database, input.vendorAccountId, input.licenseTypeId);
    const operatingDate = ecuadorOperatingDate(occurredAt);
    const capacity = await client.query<{ free: number }>(
      `SELECT greatest(0,selected.purchased_qty
          - (SELECT count(*) FROM license_assignment assignment
             JOIN person holder ON holder.id=assignment.person_id
              AND holder.company_id=assignment.company_id
             WHERE assignment.vendor_account_id=$1 AND assignment.license_type_id=$2
               AND assignment.started_on <= $3::date
               AND (assignment.ended_on IS NULL OR assignment.ended_on >= $3::date))
          - (SELECT count(*) FROM provisioning_action action
             JOIN license_request pending ON pending.id=action.request_id
              AND pending.vendor_account_id=action.vendor_account_id
             WHERE action.vendor_account_id=$1 AND pending.license_type_id=$2
               AND ((action.kind='invite' AND action.mode='automated')
                 OR (action.kind='checklist' AND action.mode='orchestration'))
               AND action.status IN ('pending','sent')
               AND action.raw_request->>'operation'='provision'))::int AS free
       FROM vendor_account_capacity selected
       WHERE selected.vendor_account_id=$1
         AND selected.license_type_id=$2
         AND selected.effective_from <= $3::date
       ORDER BY selected.effective_from DESC,selected.created_at DESC,selected.id DESC
       LIMIT 1
      `,
      [input.vendorAccountId,input.licenseTypeId,operatingDate],
    );
    const free = capacity.rows[0]?.free ?? 0;
    const candidates = free === 0
      ? { rows: [] as { request_id: string }[] }
      : await client.query<{ request_id: string }>(
          `SELECT request.id::text AS request_id
           FROM license_request request JOIN person holder
             ON holder.id=request.person_id AND holder.company_id=request.company_id
           WHERE request.state='blocked_no_seat' AND request.vendor_account_id=$1
             AND request.license_type_id=$2
           ORDER BY request.created_at,request.id FOR UPDATE OF request SKIP LOCKED LIMIT $3`,
          [input.vendorAccountId,input.licenseTypeId,free],
        );
    for (const candidate of candidates.rows) {
      await routeProvisioningActionInTransaction(database, {
        actorUserId: null,
        expectedState: "blocked_no_seat",
        note: "Capacity became available",
        occurredAt,
        requestId: candidate.request_id,
      });
    }
    await client.query("COMMIT");
    return { resumedRequestIds: candidates.rows.map((row) => row.request_id) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
