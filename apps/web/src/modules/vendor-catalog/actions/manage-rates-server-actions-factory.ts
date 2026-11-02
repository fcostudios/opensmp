import { ROUTE_SCR_RATES } from "@/lib/routes";
import type { LedgerAuthorization } from "../../identity-access/authorization";
import type { RateActionState } from "../rates-action-types";
import { createRateOperations } from "./manage-rates-operations";

export function createRateServerActions({ database, now, loadAuthorization, revalidate }: {
  database: Parameters<typeof createRateOperations>[0]["database"];
  now?: () => Date;
  loadAuthorization: () => Promise<LedgerAuthorization | null>;
  revalidate: (path: string) => void | Promise<void>;
}) {
  const actions = createRateOperations({ database, now });
  return {
    async saveRateCard(previousState: RateActionState, formData: FormData): Promise<RateActionState> {
      void previousState;
      let authorization: LedgerAuthorization | null;
      try { authorization = await loadAuthorization(); }
      // @equivalent: empty catch falls through with undefined authorization and the next guard returns the same error.
      catch { return { status: "error" }; }
      // @equivalent: removing this early null guard reaches the service's identical rejection, caught below without writes/revalidation.
      if (!authorization) return { status: "error" };
      let saved: { readonly id: string };
      try { saved = await actions.saveRateCard(authorization, formData); }
      catch { return { status: "error" }; }
      await revalidate(ROUTE_SCR_RATES);
      return { status: "success", id: saved.id };
    },
  };
}
