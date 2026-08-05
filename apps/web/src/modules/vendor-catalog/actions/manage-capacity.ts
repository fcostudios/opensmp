"use server";

import { revalidatePath } from "next/cache";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

// eslint-disable-next-line no-restricted-imports -- This server action owns production wiring for the audited capacity transaction.
import { db } from "@smp/db";
// eslint-disable-next-line no-restricted-imports -- This server action only types the production transaction adapter.
import * as schema from "@smp/db/schema";

import { loadCurrentLedgerAuthorization } from "../../identity-access/server-authorization";
import { createCapacityServerActions } from "./manage-capacity-server-actions-factory";

const database = db as unknown as NodePgDatabase<typeof schema>;

const actions = createCapacityServerActions({
  database,
  loadAuthorization: loadCurrentLedgerAuthorization,
  revalidate: revalidatePath,
});

export async function registerPurchase(input: unknown): Promise<void> {
  return actions.registerPurchase(input);
}

export async function addCapacity(input: unknown): Promise<void> {
  return actions.addCapacity(input);
}

export async function saveVendorAccountCapacity(input: unknown): Promise<void> {
  return actions.saveVendorAccountCapacity(input);
}
