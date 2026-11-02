"use server";
import { revalidatePath } from "next/cache";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
// eslint-disable-next-line no-restricted-imports -- Production composition for the audited rate action.
import { db } from "@smp/db";
// eslint-disable-next-line no-restricted-imports -- Production transaction adapter type.
import * as schema from "@smp/db/schema";
import { loadCurrentLedgerAuthorization } from "../../identity-access/server-authorization";
import { createRateServerActions } from "./manage-rates-server-actions-factory";
import type { RateActionState } from "../rates-action-types";
const actions = createRateServerActions({
  database: db as unknown as NodePgDatabase<typeof schema>,
  loadAuthorization: loadCurrentLedgerAuthorization, revalidate: revalidatePath,
});
export async function saveRateCard(state: RateActionState, form: FormData): Promise<RateActionState> {
  return actions.saveRateCard(state, form);
}
