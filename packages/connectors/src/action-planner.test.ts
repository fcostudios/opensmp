import { describe, expect, it } from "vitest";

import type { VendorConnector } from "./contracts.js";
import {
  createConnectorDispatcher,
  type ConnectorProtocol,
} from "./dispatch.js";
import { planProvisioningAction } from "./action-planner.js";

const instruction = {
  licenseTypeName: "Standard",
  personEmail: "person@example.com",
  requestId: "request-1",
  vendorAccountId: "account-1",
};

function inMemoryConnector(
  capabilities: readonly ("provision" | "deprovision")[],
): VendorConnector {
  return {
    capabilities: () => new Set(capabilities),
    deprovision: async () => ({
      ok: true,
      raw: { accepted: true },
      value: { vendorRef: null },
    }),
    provision: async () => ({
      ok: true,
      raw: { accepted: true },
      value: { vendorRef: null },
    }),
    syncActivity: async () => ({
      code: "unsupported",
      checklistSteps: [],
      ok: false,
    }),
    syncCost: async () => ({
      code: "unsupported",
      checklistSteps: [],
      ok: false,
    }),
    syncMembers: async () => ({
      code: "unsupported",
      checklistSteps: [],
      ok: false,
    }),
  };
}

async function plan(input: {
  accountMode: "automated" | "orchestration";
  capability: boolean;
  connectorCapabilities?: readonly ("provision" | "deprovision")[];
  operation: "provision" | "deprovision";
  protocol: ConnectorProtocol;
}) {
  const dispatcher = createConnectorDispatcher();
  if (input.connectorCapabilities) {
    dispatcher.register(
      input.protocol,
      inMemoryConnector(input.connectorCapabilities),
    );
  }
  return planProvisioningAction(dispatcher, {
    accountMode: input.accountMode,
    context: { clientRequestId: "move-1" },
    entityIds: { licenseId: "license-1", personId: "person-1" },
    instruction,
    operation: input.operation,
    protocol: input.protocol,
    vendorCapability: input.capability,
  });
}

describe("canonical provisioning action planner", () => {
  it("plans automated actions only when account, vendor, protocol, and connector agree", async () => {
    await expect(
      plan({
        accountMode: "automated",
        capability: true,
        connectorCapabilities: ["provision"],
        operation: "provision",
        protocol: "rest",
      }),
    ).resolves.toMatchObject({
      kind: "invite",
      mode: "automated",
      rawRequest: { checklistSteps: [], operation: "provision" },
      status: "pending",
    });
    await expect(
      plan({
        accountMode: "automated",
        capability: true,
        connectorCapabilities: ["deprovision"],
        operation: "deprovision",
        protocol: "rest",
      }),
    ).resolves.toMatchObject({
      kind: "remove",
      mode: "automated",
      rawRequest: { checklistSteps: [], operation: "deprovision" },
      status: "pending",
    });
  });

  it("rejects invalid instructions before planning an automated action", async () => {
    const dispatcher = createConnectorDispatcher();
    dispatcher.register(
      "rest",
      inMemoryConnector(["provision", "deprovision"]),
    );
    await expect(
      planProvisioningAction(dispatcher, {
        accountMode: "automated",
        context: { clientRequestId: "move-1" },
        entityIds: { licenseId: "license-1", personId: "person-1" },
        instruction: {
          ...instruction,
          personEmail: "invalid\u0000@example.com",
        },
        operation: "provision",
        protocol: "rest",
        vendorCapability: true,
      }),
    ).rejects.toThrow("Invalid connector instruction input: personEmail");
  });

  it.each([
    ["orchestration", true, ["deprovision"], "rest"],
    ["automated", false, ["deprovision"], "rest"],
    ["automated", true, [], "rest"],
    ["automated", true, undefined, "scim"],
    ["automated", true, undefined, "none"],
  ] as const)(
    "falls back safely for mode=%s vendorCapability=%s connector=%s protocol=%s",
    async (accountMode, capability, connectorCapabilities, protocol) => {
      const result = await plan({
        accountMode,
        capability,
        connectorCapabilities,
        operation: "deprovision",
        protocol,
      });
      expect(result).toMatchObject({
        kind: "checklist",
        mode: "orchestration",
        status: "pending",
      });
      expect(result.rawRequest).toMatchObject({
        checklistSteps: [
          expect.objectContaining({
            messageKey: "connector.manual.open_vendor_console",
          }),
          expect.objectContaining({
            messageKey: "connector.manual.remove_person",
          }),
          expect.objectContaining({
            messageKey: "connector.manual.revoke_license",
          }),
          expect.objectContaining({
            messageKey: "connector.manual.confirm_execution",
          }),
        ],
        context: { clientRequestId: "move-1" },
        operation: "deprovision",
        version: 1,
      });
      expect(Object.isFrozen(result)).toBe(true);
    },
  );

  it("builds the canonical provision checklist on manual fallback", async () => {
    await expect(
      plan({
        accountMode: "orchestration",
        capability: true,
        operation: "provision",
        protocol: "rest",
      }),
    ).resolves.toMatchObject({
      kind: "checklist",
      mode: "orchestration",
      rawRequest: {
        checklistSteps: [
          { messageKey: "connector.manual.open_vendor_console" },
          { messageKey: "connector.manual.invite_person" },
          { messageKey: "connector.manual.assign_license" },
          { messageKey: "connector.manual.confirm_execution" },
        ],
        operation: "provision",
      },
    });
  });
});
