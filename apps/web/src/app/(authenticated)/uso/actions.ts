"use server";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { revalidatePath } from "next/cache";
// eslint-disable-next-line no-restricted-imports -- Production wiring for the audited usage proposal transaction.
import { db } from "@smp/db";
// eslint-disable-next-line no-restricted-imports -- Types the production transaction adapter.
import * as schema from "@smp/db/schema";
import { loadCurrentLedgerAuthorization } from "@/modules/identity-access/server-authorization";
import { createReclamationServerActions } from "@/modules/usage/reclamation-server-actions-factory";
import type { ReclamationResult } from "@/modules/usage/reclamation-command";
const database = db as unknown as NodePgDatabase<typeof schema>;
const actions = createReclamationServerActions({ database, loadAuthorization: loadCurrentLedgerAuthorization, revalidate: revalidatePath });
export async function proposeReclamations(input: unknown): Promise<ReclamationResult> { return actions.proposeReclamations(input); }
