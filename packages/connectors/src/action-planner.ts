import {
  assertJsonValue,
  type JsonValue,
  type ProvisionInput,
} from "./contracts.js";
import {
  buildManualChecklistActions,
  validateProvisionInstruction,
  type ConnectorDispatcher,
  type ConnectorProtocol,
  type ManualChecklistEntityIds,
  type ManualChecklistOperation,
} from "./dispatch.js";

export interface ProvisioningActionPlan {
  readonly kind: "checklist" | "invite" | "remove";
  readonly mode: "automated" | "orchestration";
  readonly rawRequest: JsonValue;
  readonly status: "pending";
}

export async function planProvisioningAction(
  dispatcher: ConnectorDispatcher,
  input: {
    readonly accountMode: "automated" | "orchestration";
    readonly context: JsonValue;
    readonly entityIds: ManualChecklistEntityIds;
    readonly instruction: ProvisionInput;
    readonly operation: ManualChecklistOperation;
    readonly protocol: ConnectorProtocol;
    readonly vendorCapability: boolean;
  },
): Promise<ProvisioningActionPlan> {
  const capability =
    input.operation === "provision" ? "provision" : "deprovision";
  validateProvisionInstruction(input.instruction);
  let automated = false;
  if (
    input.accountMode === "automated" &&
    input.vendorCapability
  ) {
    try {
      automated = dispatcher
        .forProtocol(input.protocol)
        .capabilities()
        .has(capability);
    } catch {
      // Missing connector registration preserves the fail-closed default.
    }
  }

  let checklistSteps: readonly unknown[] = [];
  if (!automated) {
    const manualConnector = dispatcher.forProtocol("none");
    // Stryker disable next-line all: @equivalent The built-in none connector
    // validates both operations identically and only supplies a non-empty
    // unsupported marker; canonical steps are selected by the builder below.
    const unsupported = input.operation === "provision"
      ? await manualConnector.provision(input.instruction)
      : await manualConnector.deprovision(input.instruction);
    // Stryker disable all: @equivalent ConnectorDispatcher reserves protocol
    // "none" for its built-in connector, whose typed contract always returns
    // unsupported.
    /* c8 ignore next 3 */
    if (unsupported.ok || unsupported.code !== "unsupported") {
      throw new Error("manual connector must return an unsupported checklist");
    }
    // Stryker restore all
    checklistSteps = buildManualChecklistActions(
      input.operation,
      input.instruction,
      unsupported,
      input.entityIds,
    );
  }

  const rawRequest = assertJsonValue({
    checklistSteps,
    context: input.context,
    instruction: input.instruction,
    operation: input.operation,
    protocol: input.protocol,
    version: 1,
  });
  return Object.freeze({
    kind: automated
      ? input.operation === "provision"
        ? "invite"
        : "remove"
      : "checklist",
    mode: automated ? "automated" : "orchestration",
    rawRequest,
    status: "pending",
  });
}
