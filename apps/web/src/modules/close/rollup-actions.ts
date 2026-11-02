"use server";
import { loadCurrentLedgerAuthorization } from "../identity-access/server-authorization";
import { closeDatabase } from "./production";
import { createRollupService } from "./rollup-transaction";

const service = createRollupService(closeDatabase);

export async function exportRollupCsv(period: string) {
  return service.exportRollupCsv(await loadCurrentLedgerAuthorization(), period);
}
