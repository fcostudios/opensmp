import type { LedgerAuthorization } from "../../identity-access/authorization";
import { createManageCapacityActions } from "./manage-capacity-operations";

type Database = Parameters<typeof createManageCapacityActions>[0]["database"];

export function createCapacityServerActions({
  database,
  loadAuthorization,
  now,
  revalidate,
}: {
  readonly database: Database;
  readonly loadAuthorization: () => Promise<LedgerAuthorization | null>;
  readonly now?: () => Date;
  readonly revalidate: (path: string) => void;
}) {
  const actions = createManageCapacityActions({ database, now });

  return {
    async addCapacity(input: unknown): Promise<void> {
      const authorization = await loadAuthorization();
      if (!authorization) throw new Error("CAPACITY_ACCESS_FORBIDDEN");
      await actions.addCapacity(authorization, input);
      revalidate("/cupos");
      revalidate("/excepciones");
    },
    async registerPurchase(input: unknown): Promise<void> {
      const authorization = await loadAuthorization();
      if (!authorization) throw new Error("CAPACITY_ACCESS_FORBIDDEN");
      await actions.registerPurchase(authorization, input);
      revalidate("/cupos");
      revalidate("/excepciones");
    },
    async saveVendorAccountCapacity(input: unknown): Promise<void> {
      const authorization = await loadAuthorization();
      if (!authorization) throw new Error("CAPACITY_ACCESS_FORBIDDEN");
      await actions.saveVendorAccountCapacity(authorization, input);
      revalidate("/cupos");
      revalidate("/excepciones");
    },
  };
}
