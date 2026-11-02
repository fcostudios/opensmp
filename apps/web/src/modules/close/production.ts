import type { NodePgDatabase } from "drizzle-orm/node-postgres";
// eslint-disable-next-line no-restricted-imports -- Production composition for the close transaction service.
import { db } from "@smp/db";
// eslint-disable-next-line no-restricted-imports -- Production database adapter type.
import * as schema from "@smp/db/schema";
import { createCloseService } from "./close-transaction";
export const closeDatabase = db as unknown as NodePgDatabase<typeof schema>;
const closeService = createCloseService(closeDatabase);

import type { LedgerAuthorization } from "../identity-access/authorization";
export async function loadLatestCloseRun(authorization: LedgerAuthorization, period: string) {
  return closeService.latestRun(authorization, period);
}

export async function loadCloseStatements(authorization: LedgerAuthorization, period: string) {
  return closeService.statements(authorization, period);
}

export async function loadCloseSummary(authorization: LedgerAuthorization, period: string) {
  return closeService.summary(authorization, period);
}
