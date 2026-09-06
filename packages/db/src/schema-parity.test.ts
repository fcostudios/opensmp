import { describe, expect, test } from "vitest";
import { isTable } from "drizzle-orm/table";
import * as db from "./index";
import * as schema from "./schema";

const expectedTables = [
  "alertEvent",
  "alertNotificationDelivery",
  "alertRule",
  "activityRecord",
  "auditLog",
  "closeRun",
  "capacityRecoveryWork",
  "company",
  "companyRoleAssignment",
  "connectorCallObservation",
  "costRecord",
  "identityProviderOperation",
  "integrationCredential",
  "licenseAssignment",
  "licenseRequest",
  "licenseType",
  "lifecycleNotification",
  "lifecycleNotificationDelivery",
  "person",
  "provisioningAction",
  "rateCard",
  "reclamationProposal",
  "reconciliation",
  "reconciliationVarianceLine",
  "requestTransition",
  "statement",
  "statementLine",
  "systemSetting",
  "userAccount",
  "vendor",
  "vendorAccount",
  "vendorAccountCapacity",
] as const;

describe("US-003 schema contract", () => {
  test("exports the complete domain and durable-notification Drizzle schema", () => {
    expect(
      Object.entries(schema)
        .filter(([, exported]) => isTable(exported))
        .map(([name]) => name)
        .sort(),
    ).toEqual([...expectedTables].sort());
  });

  test("exports the deterministic system actor from the database package", () => {
    const exported = db as unknown as Record<string, string>;
    expect(exported.SYSTEM_USER_EMAIL).toBe("system@ledger.invalid");
    expect(exported.SYSTEM_USER_ID).toBe("00000000-0000-0000-0000-000000000001");
  });
});
