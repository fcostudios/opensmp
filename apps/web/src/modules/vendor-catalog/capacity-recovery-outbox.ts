import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

// eslint-disable-next-line no-restricted-imports -- This module owns the transactional recovery-outbox boundary.
import type * as schema from "@smp/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

interface CapacityRecoveryWorkBase {
  readonly effectiveFrom: string;
  readonly licenseTypeId: string;
  readonly occurredAt: Date;
  readonly vendorAccountId: string;
}

export type CapacityRecoveryWork = CapacityRecoveryWorkBase & (
  | {
      readonly capacityId: string;
      readonly releaseEventId?: never;
      readonly source: "capacity_change";
    }
  | {
      readonly capacityId: null;
      readonly releaseEventId: string;
      readonly source: "seat_freed";
    }
);

/** Enqueue in the same transaction that persisted the capacity or freed seat. */
export async function enqueueCapacityRecovery(
  transaction: Transaction,
  work: CapacityRecoveryWork,
): Promise<void> {
  await transaction.execute(
    sql`SELECT enqueue_capacity_recovery(
          ${work.capacityId}::uuid, ${work.vendorAccountId}::uuid,
          ${work.licenseTypeId}::uuid, ${work.effectiveFrom}::date,
          ${work.source}, ${work.occurredAt},
          ${work.releaseEventId ?? null}::uuid)`,
  );
}
