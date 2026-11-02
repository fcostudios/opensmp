"use server";
import { revalidatePath } from "next/cache";
import type { ReconciliationState } from "@smp/contracts/reconciliation";
import { loadCurrentLedgerAuthorization } from "../identity-access/server-authorization";
import { closeDatabase } from "./production";
import { createReconciliationActions } from "./reconciliation-actions-factory";
const actions = createReconciliationActions({ database: closeDatabase, loadAuthorization: loadCurrentLedgerAuthorization, revalidate: revalidatePath });
export async function saveInvoiceAmount(state: ReconciliationState, form: FormData) { return actions.saveInvoiceAmount(state, form); }
export async function overrideReconciliation(state: ReconciliationState, form: FormData) { return actions.overrideReconciliation(state, form); }
export async function saveVarianceLine(state: ReconciliationState, form: FormData) { return actions.saveVarianceLine(state, form); }
export async function deleteVarianceLine(state: ReconciliationState, form: FormData) { return actions.deleteVarianceLine(state, form); }
