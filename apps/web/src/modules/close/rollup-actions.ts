"use server";
import { loadCurrentLedgerAuthorization } from "../identity-access/server-authorization";
import { closeDatabase } from "./production";
import { createRollupService } from "./rollup-transaction";

export async function exportRollupCsv(period: string) {
  return createRollupService(closeDatabase).exportRollupCsv(await loadCurrentLedgerAuthorization(), period);
}
