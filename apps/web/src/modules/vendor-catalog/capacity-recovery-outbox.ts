import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

// eslint-disable-next-line no-restricted-imports -- This module owns the transactional recovery-outbox boundary.
import type * as schema from "@smp/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface CapacityRecoveryWork {
  readonly capacityId: string | null;
  readonly effectiveFrom: string;
  readonly licenseTypeId: string;
  readonly occurredAt: Date;
  readonly source: "capacity_change" | "seat_freed";
  readonly vendorAccountId: string;
}

/** Enqueue in the same transaction that persisted the capacity or freed seat. */
export async function enqueueCapacityRecovery(
  transaction: Transaction,
  work: CapacityRecoveryWork,
): Promise<void> {
  await transaction.execute(
    sql`SELECT enqueue_capacity_recovery(
          ${work.capacityId}::uuid, ${work.vendorAccountId}::uuid,
          ${work.licenseTypeId}::uuid, ${work.effectiveFrom}::date,
          ${work.source}, ${work.occurredAt})`,
  );
}

