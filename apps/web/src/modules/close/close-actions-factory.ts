import type { CloseActionState } from "@smp/contracts/close";
import type { LedgerAuthorization } from "../identity-access/authorization";
import { ROUTE_SCR_CLOSE, ROUTE_SCR_STATEMENTS } from "@/lib/routes";
import { createCloseOperations } from "./close-operations";
export function createCloseActions({ database, now, loadAuthorization, revalidate }: {
  database: Parameters<typeof createCloseOperations>[0]["database"]; now?: () => Date;
  loadAuthorization: () => Promise<LedgerAuthorization | null>;
  revalidate: (path: string) => void | Promise<void>;
}) {
  const closeReadPaths = [ROUTE_SCR_CLOSE, ROUTE_SCR_STATEMENTS];
  const actions = createCloseOperations({ database, now });
  return {
    async runClose(previous: CloseActionState, form: FormData): Promise<CloseActionState> {
      void previous;
      let authorization: LedgerAuthorization | null;
      // @equivalent: an empty catch leaves authorization undefined; the next guard returns the identical error.
      try { authorization = await loadAuthorization(); } catch { return { status: "error" }; }
      // @equivalent: the service independently rejects null authorization before writes, and the catch returns the same error.
      if (!authorization) return { status: "error" };
      let run: { status: string; id: string; durationMs: number };
      try { run = await actions.runClose(authorization, form); } catch { return { status: "error" }; }
      await revalidate(closeReadPaths[0]);
      await revalidate(closeReadPaths[1]);
      return { status: run.status as "succeeded" | "failed", runId: run.id, durationMs: run.durationMs };
    },
  };
}
