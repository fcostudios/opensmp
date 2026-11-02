import type { NodePgDatabase } from "drizzle-orm/node-postgres";
// eslint-disable-next-line no-restricted-imports -- Production composition of the global financial catalog service.
import { db } from "@smp/db";
// eslint-disable-next-line no-restricted-imports -- Production database adapter type.
import * as schema from "@smp/db/schema";
import { createRateService } from "./rate-service";
import type { LedgerAuthorization } from "../identity-access/authorization";
const rateService = createRateService(db as unknown as NodePgDatabase<typeof schema>);
export async function loadRatesWorkspace(authorization: LedgerAuthorization) {
  return rateService.workspace(authorization);
}
