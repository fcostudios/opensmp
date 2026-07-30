// eslint-disable-next-line no-restricted-imports -- This repository owns the canonical pool data-access boundary.
import { listCurrentSeatPoolCounts } from "@smp/db/pool-snapshots";
import { ecuadorOperatingDate } from "@smp/domain/jobs/schedule";
import { calculatePool } from "@smp/domain/vendor-catalog/pool-math";
import pg from "pg";
import { z } from "zod";

import type { LedgerAuthorization } from "../identity-access/authorization";

export type VendorPoolSnapshot = Awaited<
  ReturnType<typeof listCurrentSeatPoolCounts>
>[number] & {
  readonly free: number;
  readonly isLow: boolean;
};

function assertPoolAccess(authorization: LedgerAuthorization): void {
  if (authorization.globalRole !== "group_admin") {
    throw new Error("POOL_ACCESS_FORBIDDEN");
  }
}

export function poolOperatingDate(at: Date): string {
  return ecuadorOperatingDate(at);
}

export function parseVendorAccountId(value: string): string | null {
  const result = z.string().uuid().safeParse(value);
  return result.success ? result.data : null;
}

export function createPoolRepository(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  return {
    async close(): Promise<void> {
      await pool.end();
    },

    async listSnapshots(
      authorization: LedgerAuthorization,
      at: Date,
      vendorAccountId?: string,
    ): Promise<VendorPoolSnapshot[]> {
      assertPoolAccess(authorization);
      const snapshots = await listCurrentSeatPoolCounts(pool, {
        asOf: at,
        operatingDate: poolOperatingDate(at),
        vendorAccountId,
      });
      return snapshots.map((snapshot) => {
        const calculated = calculatePool(snapshot);
        return {
          ...snapshot,
          ...calculated,
          isLow: calculated.free < snapshot.lowPoolFloor,
        };
      });
    },
  };
}

export type PoolRepository = ReturnType<typeof createPoolRepository>;
