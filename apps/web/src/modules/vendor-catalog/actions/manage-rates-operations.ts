import { createRateService } from "../rate-service";
import type { LedgerAuthorization } from "../../identity-access/authorization";

export function createRateOperations({ database, now }: {
  database: Parameters<typeof createRateService>[0]; now?: () => Date;
}) {
  const service = createRateService(database, { now });
  return {
    async saveRateCard(authorization: LedgerAuthorization, form: FormData) {
      return service.saveRateCard(authorization, {
        ...(form.get("id") ? { id: form.get("id") } : {}),
        vendorAccountId: form.get("vendorAccountId"), licenseTypeId: form.get("licenseTypeId"),
        monthlyRateUsd: form.get("monthlyRateUsd"), effectiveFrom: form.get("effectiveFrom"),
        effectiveTo: form.get("effectiveTo") || null, provisional: form.get("provisional") === "on",
      });
    },
  };
}
