"use server";

import { loadCurrentLedgerAuthorization } from "../identity-access/server-authorization";
import { createRegisterCsvDownload } from "./actions";
import { revalidatePath } from "next/cache";
import { manualRegisterService as manualService } from "./manual-entry-transaction";

/** @read-only-action Produces an authorized, filter-preserving CSV download URL. */
export async function exportRegisterCsv(input: unknown): Promise<{ readonly downloadUrl: string }> {
  return createRegisterCsvDownload(
    await loadCurrentLedgerAuthorization(),
    input,
  );
}

export async function recordManualAssignment(input: unknown) {
  const authorization = await loadCurrentLedgerAuthorization();
  await manualService.record(authorization, input);
  revalidatePath("/registro");
  return { ok: true as const };
}

export async function closeManualAssignment(input: unknown) {
  const authorization = await loadCurrentLedgerAuthorization();
  await manualService.close(authorization, input);
  revalidatePath("/registro");
  return { ok: true as const };
}
