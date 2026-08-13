"use server";

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { revalidatePath } from "next/cache";

// eslint-disable-next-line no-restricted-imports -- This server action owns production wiring for the audited vendor-account transaction.
import { db } from "@smp/db";
// eslint-disable-next-line no-restricted-imports -- This server action only types the production transaction adapter.
import * as schema from "@smp/db/schema";

import { loadCurrentLedgerAuthorization } from "../../identity-access/server-authorization";
import type { VendorAccountActionState } from "./manage-vendor-accounts-operations";
import { createVendorAccountServerActions } from "./manage-vendor-accounts-server-actions-factory";

const database = db as unknown as NodePgDatabase<typeof schema>;
const actions = createVendorAccountServerActions({
  database,
  loadAuthorization: loadCurrentLedgerAuthorization,
  revalidate: revalidatePath,
});

export async function createVendorAccount(
  previousState: VendorAccountActionState,
  formData: FormData,
): Promise<VendorAccountActionState> {
  return actions.createVendorAccount(previousState, formData);
}

export async function updateVendorAccount(
  vendorAccountId: string,
  previousState: VendorAccountActionState,
  formData: FormData,
): Promise<VendorAccountActionState> {
  return actions.updateVendorAccount(vendorAccountId, previousState, formData);
}
