"use server";
import { revalidatePath } from "next/cache";
import type { CloseActionState, FinalizeActionState } from "@smp/contracts/close";
import { loadCurrentLedgerAuthorization } from "../identity-access/server-authorization";
import { closeDatabase } from "./production";
import { createCloseActions } from "./close-actions-factory";
const actions = createCloseActions({ database: closeDatabase, loadAuthorization: loadCurrentLedgerAuthorization, revalidate: revalidatePath });
export async function runClose(state: CloseActionState, form: FormData): Promise<CloseActionState> {
  return actions.runClose(state, form);
}

export async function finalizeStatement(state: FinalizeActionState, form: FormData): Promise<FinalizeActionState> {
  const result = await actions.finalizeStatement(state, form);
  if (result.status === "finalized") revalidatePath("/estados-de-cuenta", "layout");
  return result;
}
export async function finalizeStatements(state: FinalizeActionState, form: FormData): Promise<FinalizeActionState> {
  const result = await actions.finalizeStatements(state, form);
  if (result.status === "finalized") revalidatePath("/estados-de-cuenta", "layout");
  return result;
}
