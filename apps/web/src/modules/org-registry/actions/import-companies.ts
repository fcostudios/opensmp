"use server";

import { goLiveCsvInputSchema } from "@smp/contracts";

import { auth } from "@/lib/auth/auth-config";
import {
  dryRunGoLiveImport,
  auditedGoLiveImportBoundary,
  prepareProductionGoLiveImport,
  productionImportDatabase,
} from "../register-backfill-transaction";

/** @read-only-action */
export async function previewCompaniesCsv(input: unknown) {
  const session = await auth();
  if (!session?.user || session.user.globalRole !== "group_admin") {
    throw new Error("Forbidden");
  }
  const parsed = goLiveCsvInputSchema.parse(input);
  const prepared = await prepareProductionGoLiveImport({
    ...parsed,
    actorUserId: session.user.id,
  });
  return dryRunGoLiveImport(
    productionImportDatabase,
    prepared,
    prepared.credentials,
  );
}

export async function importCompaniesCsv(input: unknown) {
  const session = await auth();
  if (!session?.user || session.user.globalRole !== "group_admin") {
    throw new Error("Forbidden");
  }
  const parsed = goLiveCsvInputSchema.parse(input);
  return auditedGoLiveImportBoundary.run(
    productionImportDatabase,
    await prepareProductionGoLiveImport({
      ...parsed,
      actorUserId: session.user.id,
    }),
  );
}
