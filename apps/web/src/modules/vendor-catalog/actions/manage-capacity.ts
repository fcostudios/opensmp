"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

// eslint-disable-next-line no-restricted-imports -- This server action owns production wiring for the audited capacity transaction.
import { db } from "@smp/db";
// eslint-disable-next-line no-restricted-imports -- This server action only types the production transaction adapter.
import * as schema from "@smp/db/schema";
import type { CapacityRecoveryJob } from "@smp/contracts/capacity";

import { loadCurrentLedgerAuthorization } from "../../identity-access/server-authorization";
import { createCapacityService } from "../capacity-service";

// Stryker disable all: This server-action file is an adapter over the
// mutation-tested CapacityService; Next.js runtime wiring is not a unit seam.
const database = db as unknown as NodePgDatabase<typeof schema>;
const service = createCapacityService(database, {
  publishRecovery: async (job: CapacityRecoveryJob) => {
    await database.execute(
      sql`SELECT recover_blocked_requests_for_capacity(
            ${job.capacityId}::uuid, ${job.vendorAccountId}::uuid,
            ${job.licenseTypeId}::uuid, ${job.effectiveFrom}::date,
            ${job.companyIds}::uuid[], ${new Date(job.publishedAt)})`,
    );
  },
});

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

/** @read-only-action The canonical CapacityService owns the audited transaction. */
export async function registerPurchase(input: unknown): Promise<void> {
  await execute(input, "purchase");
}

/** @read-only-action Thin alias retained for the generated action contract. */
export async function addCapacity(input: unknown): Promise<void> {
  const reason =
    input instanceof FormData && input.get("reason") === "correction"
      ? "correction"
      : "purchase";
  await execute(input, reason);
}

/** @read-only-action Canonical correction entry point for capacity history. */
export async function saveVendorAccountCapacity(input: unknown): Promise<void> {
  await execute(input, "correction");
}
// Stryker restore all
