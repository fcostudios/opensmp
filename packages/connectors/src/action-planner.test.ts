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
  canDeprovision: boolean;
  canProvision: boolean;
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
    vendor: {
      canDeprovision: input.canDeprovision,
      canProvision: input.canProvision,
      provisioningProtocol: input.protocol,
    },
  });
}

describe("canonical provisioning action planner", () => {
  it("reads only canProvision when planning a provision operation", async () => {
    await expect(
      plan({
        accountMode: "automated",
        canDeprovision: false,
        canProvision: true,
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
  });

  it("reads only canDeprovision when planning a deprovision operation", async () => {
    await expect(
      plan({
        accountMode: "automated",
        canDeprovision: true,
        canProvision: false,
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
        vendor: {
          canDeprovision: false,
          canProvision: true,
          provisioningProtocol: "rest",
        },
      }),
    ).rejects.toThrow("Invalid connector instruction input: personEmail");
  });

  it.each([
    ["orchestration account mode", "orchestration", true, ["deprovision"], "rest"],
    ["missing Vendor flag", "automated", false, ["deprovision"], "rest"],
    ["missing connector operation capability", "automated", true, [], "rest"],
    ["missing SCIM connector registration", "automated", true, undefined, "scim"],
    ["missing REST connector registration", "automated", true, undefined, "rest"],
    ["protocol none", "automated", true, undefined, "none"],
  ] as const)(
    "falls back to a checklist for %s",
    async (_case, accountMode, canDeprovision, connectorCapabilities, protocol) => {
      const result = await plan({
        accountMode,
        canDeprovision,
        canProvision: !canDeprovision,
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
        canDeprovision: false,
        canProvision: true,
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

  it("records the Vendor descriptor protocol in the raw request", async () => {
    const result = await plan({
      accountMode: "automated",
      canDeprovision: false,
      canProvision: true,
      connectorCapabilities: ["provision"],
      operation: "provision",
      protocol: "scim",
    });

    expect(result.rawRequest).toMatchObject({ protocol: "scim" });
  });
});
