"use server";

import { loadCurrentLedgerAuthorization } from "../identity-access/server-authorization";
import { createRegisterCsvDownload } from "./actions";

/** @read-only-action Produces an authorized, filter-preserving CSV download URL. */
export async function exportRegisterCsv(input: unknown): Promise<{ readonly downloadUrl: string }> {
  return createRegisterCsvDownload(
    await loadCurrentLedgerAuthorization(),
    input,
  );
}
