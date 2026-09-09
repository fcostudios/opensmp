import { db } from "@smp/db";
import type * as schema from "@smp/db/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { LedgerAuthorization } from "../../identity-access/authorization";
import { createProvisioningService } from "../provisioning-service";

export async function loadProductionRetryAuthorization(): Promise<LedgerAuthorization | null> {
  const { loadCurrentLedgerAuthorization } = await import(
    "../../identity-access/server-authorization"
  );
  return loadCurrentLedgerAuthorization();
}

const productionDatabase = db as unknown as NodePgDatabase<typeof schema>;
export const productionProvisioningService = createProvisioningService(productionDatabase);
