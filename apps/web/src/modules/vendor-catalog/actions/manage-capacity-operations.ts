import type { NodePgDatabase } from "drizzle-orm/node-postgres";

// eslint-disable-next-line no-restricted-imports -- This factory composes the audited capacity transaction service.
import * as schema from "@smp/db/schema";

import type { LedgerAuthorization } from "../../identity-access/authorization";
import { createCapacityService } from "../capacity-service";

export function actionInput(input: unknown, reason: "purchase" | "correction") {
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

export function createManageCapacityActions({
  database,
  now,
}: {
  readonly database: NodePgDatabase<typeof schema>;
  readonly now?: () => Date;
}) {
  const service = createCapacityService(database, { now });
  async function execute(
    authorization: LedgerAuthorization,
    input: unknown,
    reason: "purchase" | "correction",
  ) {
    await service.changeCapacity(authorization, actionInput(input, reason));
  }

  return {
    addCapacity(authorization: LedgerAuthorization, input: unknown): Promise<void> {
      return execute(
        authorization,
        input,
        input instanceof FormData && input.get("reason") === "correction"
          ? "correction"
          : "purchase",
      );
    },
    registerPurchase(authorization: LedgerAuthorization, input: unknown): Promise<void> {
      return execute(authorization, input, "purchase");
    },
    saveVendorAccountCapacity(authorization: LedgerAuthorization, input: unknown): Promise<void> {
      return execute(authorization, input, "correction");
    },
  };
}
