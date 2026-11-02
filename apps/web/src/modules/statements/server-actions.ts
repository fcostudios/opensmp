"use server";

import { loadCurrentLedgerAuthorization } from "../identity-access/server-authorization";
import { createStatementCsvDownload } from "./export-transaction";

/** @read-only-action Produces a scoped download URL. The download records the export audit. */
export async function exportStatementCsv(input: unknown) {
  return createStatementCsvDownload(await loadCurrentLedgerAuthorization(), input);
}
