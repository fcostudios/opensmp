import type { LedgerAuthorization } from "../../identity-access/authorization";
import type { createCapacityService } from "../capacity-service";

type CapacityService = ReturnType<typeof createCapacityService>;

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
  loadAuthorization,
  revalidate,
  service,
}: {
  readonly loadAuthorization: () => Promise<LedgerAuthorization | null>;
  readonly revalidate: (path: string) => void;
  readonly service: CapacityService;
}) {
  async function execute(input: unknown, reason: "purchase" | "correction") {
    const authorization = await loadAuthorization();
    if (!authorization) throw new Error("CAPACITY_ACCESS_FORBIDDEN");
    await service.changeCapacity(authorization, actionInput(input, reason));
    revalidate("/cupos");
    revalidate("/excepciones");
  }

  return {
    addCapacity(input: unknown): Promise<void> {
      return execute(
        input,
        input instanceof FormData && input.get("reason") === "correction"
          ? "correction"
          : "purchase",
      );
    },
    registerPurchase(input: unknown): Promise<void> {
      return execute(input, "purchase");
    },
    saveVendorAccountCapacity(input: unknown): Promise<void> {
      return execute(input, "correction");
    },
  };
}
