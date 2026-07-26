"use server";

import { goLiveCsvInputSchema } from "@smp/contracts";

import { auth } from "@/lib/auth/auth-config";
import {
  dryRunGoLiveImport,
  goLiveImportService,
  productionImportDatabase,
} from "../register-backfill-transaction";

/** @read-only-action */
export async function previewCompaniesCsv(input: unknown) {
  const session = await auth();
  if (!session?.user || session.user.globalRole !== "group_admin") {
    throw new Error("Forbidden");
  }
  const parsed = goLiveCsvInputSchema.parse(input);
  return dryRunGoLiveImport(productionImportDatabase, parsed);
}

export async function importCompaniesCsv(input: unknown) {
  const session = await auth();
  if (!session?.user || session.user.globalRole !== "group_admin") {
    throw new Error("Forbidden");
  }
  const parsed = goLiveCsvInputSchema.parse(input);
  return goLiveImportService.import(productionImportDatabase, {
    ...parsed,
    actorUserId: session.user.id,
  });
}
