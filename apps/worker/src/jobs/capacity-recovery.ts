import type { CapacityRecoveryJob } from "@smp/contracts/capacity";
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
            const scope = await pool.query<{ company_id: string }>(
              `SELECT DISTINCT request.company_id::text
               FROM license_request request JOIN person holder
                 ON holder.id=request.person_id AND holder.company_id=request.company_id
               WHERE request.state='blocked_no_seat'
                 AND request.vendor_account_id=$1 AND request.license_type_id=$2`,
              [work.vendor_account_id, work.license_type_id],
            );
            const capacity = work.capacity_id
              ? work.capacity_id
              : (
                  await pool.query<{ id: string }>(
                    `SELECT id::text FROM vendor_account_capacity
                     WHERE vendor_account_id=$1 AND license_type_id=$2
                       AND effective_from <= $3::date
                     ORDER BY effective_from DESC,created_at DESC,id DESC LIMIT 1`,
                    [work.vendor_account_id, work.license_type_id, at],
                  )
                ).rows[0]?.id;
            if (capacity && scope.rows.length) {
              await recover(
                pool,
                {
                  capacityId: capacity,
                  companyIds: scope.rows.map((row) => row.company_id),
                  effectiveFrom: work.effective_from,
                  licenseTypeId: work.license_type_id,
                  publishedAt: at.toISOString(),
                  vendorAccountId: work.vendor_account_id,
                },
                at,
              );
            }
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
