"use server";

import { revalidatePath } from "next/cache";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

// eslint-disable-next-line no-restricted-imports -- This server action owns production wiring for the audited capacity transaction.
import { db } from "@smp/db";
// eslint-disable-next-line no-restricted-imports -- This server action only types the production transaction adapter.
import * as schema from "@smp/db/schema";

import { loadCurrentLedgerAuthorization } from "../../identity-access/server-authorization";
import { createManageCapacityActions } from "./manage-capacity-operations";

const database = db as unknown as NodePgDatabase<typeof schema>;
type CapacityActions = ReturnType<typeof createManageCapacityActions>;

export function createCapacityServerActions({
  actions,
  loadAuthorization,
  revalidate,
}: {
  readonly actions: CapacityActions;
  readonly loadAuthorization: typeof loadCurrentLedgerAuthorization;
  readonly revalidate: typeof revalidatePath;
}) {
  async function execute(
    operation: keyof CapacityActions,
    input: unknown,
  ): Promise<void> {
    const authorization = await loadAuthorization();
    if (!authorization) throw new Error("CAPACITY_ACCESS_FORBIDDEN");
    await actions[operation](authorization, input);
    revalidate("/cupos");
    revalidate("/excepciones");
  }

  return {
    addCapacity(input: unknown): Promise<void> {
      return execute("addCapacity", input);
    },
    registerPurchase(input: unknown): Promise<void> {
      return execute("registerPurchase", input);
    },
    saveVendorAccountCapacity(input: unknown): Promise<void> {
      return execute("saveVendorAccountCapacity", input);
    },
  };
}

const actions = createCapacityServerActions({
  actions: createManageCapacityActions({ database }),
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
