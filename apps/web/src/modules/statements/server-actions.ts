"use server";

import { loadCurrentLedgerAuthorization } from "../identity-access/server-authorization";
import { createStatementCsvDownload, createStatementPdfDownload } from "./export-transaction";

/** @read-only-action Produces a scoped download URL. The download records the export audit. */
export async function exportStatementCsv(input: unknown) {
  return createStatementCsvDownload(await loadCurrentLedgerAuthorization(), input);
}

/** @read-only-action Produces a scoped PDF URL. Only the download records an export audit. */
export async function exportStatementPdf(input: unknown) {
  return createStatementPdfDownload(await loadCurrentLedgerAuthorization(), input);
}
