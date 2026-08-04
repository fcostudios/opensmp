import type { LedgerAuthorization } from "../../identity-access/authorization";
import type { createManageCapacityActions } from "./manage-capacity-operations";

type CapacityActions = ReturnType<typeof createManageCapacityActions>;

export function createCapacityServerActions({
  actions,
  loadAuthorization,
  revalidate,
}: {
  readonly actions: CapacityActions;
  readonly loadAuthorization: () => Promise<LedgerAuthorization | null>;
  readonly revalidate: (path: string) => void;
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
