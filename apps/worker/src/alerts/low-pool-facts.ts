import { listCurrentSeatPoolCounts } from "@smp/db/pool-snapshots";
import {
  calculatePool,
  ecuadorOperatingDate,
  type AlertFacts,
} from "@smp/domain";
import type pg from "pg";

type Queryable = Pick<pg.Pool, "query">;

export async function loadLowPoolFacts(
  database: Queryable,
  input: {
    readonly at: Date;
    readonly vendorAccountId: string | null;
  },
): Promise<AlertFacts[]> {
  const snapshots = await listCurrentSeatPoolCounts(database, {
    asOf: input.at,
    operatingDate: ecuadorOperatingDate(input.at),
    vendorAccountId: input.vendorAccountId ?? undefined,
  });
  return snapshots.map((snapshot) => ({
    free: calculatePool(snapshot).free,
    lowPoolFloor: snapshot.lowPoolFloor,
    subject: {
      licenseTypeId: snapshot.licenseTypeId,
      vendorAccountId: snapshot.vendorAccountId,
    },
  }));
}
