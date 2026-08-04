"use server";

import { revalidatePath } from "next/cache";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

// eslint-disable-next-line no-restricted-imports -- This server action owns production wiring for the audited capacity transaction.
import { db } from "@smp/db";
// eslint-disable-next-line no-restricted-imports -- This server action only types the production transaction adapter.
import * as schema from "@smp/db/schema";

import { loadCurrentLedgerAuthorization } from "../../identity-access/server-authorization";
import { createCapacityService } from "../capacity-service";

// Stryker disable all: This server-action file is an adapter over the
// mutation-tested CapacityService; Next.js runtime wiring is not a unit seam.
const database = db as unknown as NodePgDatabase<typeof schema>;
const service = createCapacityService(database);

function actionInput(input: unknown, reason: "purchase" | "correction") {
  if (!(input instanceof FormData)) return input;
  const note = String(input.get("note") ?? "").trim();
  return {
    effectiveFrom: String(input.get("effectiveFrom") ?? ""),
    licenseTypeId: String(input.get("licenseTypeId") ?? ""),
    ...(note ? { note } : {}),
    purchasedQty: Number(input.get("purchasedQty")),
    reason,
    vendorAccountId: String(input.get("vendorAccountId") ?? ""),
  };
}

async function execute(input: unknown, reason: "purchase" | "correction") {
  const authorization = await loadCurrentLedgerAuthorization();
  if (!authorization) throw new Error("CAPACITY_ACCESS_FORBIDDEN");
  await service.changeCapacity(authorization, actionInput(input, reason));
  revalidatePath("/cupos");
  revalidatePath("/excepciones");
}

export async function registerPurchase(input: unknown): Promise<void> {
  await execute(input, "purchase");
}

export async function addCapacity(input: unknown): Promise<void> {
  await execute(
    input,
    input instanceof FormData && input.get("reason") === "correction"
      ? "correction"
      : "purchase",
  );
}

export async function saveVendorAccountCapacity(input: unknown): Promise<void> {
  await execute(input, "correction");
}
// Stryker restore all
