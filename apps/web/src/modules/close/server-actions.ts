"use server";
import { revalidatePath } from "next/cache";
import type { CloseActionState } from "@smp/contracts/close";
import { loadCurrentLedgerAuthorization } from "../identity-access/server-authorization";
import { closeDatabase } from "./production";
import { createCloseActions } from "./close-actions-factory";
const actions = createCloseActions({ database: closeDatabase, loadAuthorization: loadCurrentLedgerAuthorization, revalidate: revalidatePath });
export async function runClose(state: CloseActionState, form: FormData): Promise<CloseActionState> {
  return actions.runClose(state, form);
}
