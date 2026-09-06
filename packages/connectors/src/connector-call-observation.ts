import type {
  ConnectorAttemptReceipt,
  ConnectorCallClassification,
  ConnectorCallObservationAppender,
  ConnectorCallObservationAppendInput,
  ConnectorCallObservationSession,
  ConnectorCallPhase,
  ConnectorCallSummary,
  ConnectorEndpointClass,
  ConnectorOperation,
} from "./contracts.js";

export type { ConnectorCallObservationAppender } from "./contracts.js";

type ConnectorMethod = "GET" | "POST" | "DELETE";

type SummaryInput = Readonly<{
  phase: ConnectorCallPhase;
  endpointClass: ConnectorEndpointClass;
  method: ConnectorMethod;
  httpStatus?: number;
  classification?: ConnectorCallClassification;
}>;

const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const connectorOperations = new Set<ConnectorOperation>([
  "provision",
  "deprovision",
  "sync_members",
  "sync_activity",
  "sync_cost",
]);
const syncOperations = new Set<ConnectorOperation>([
  "sync_members",
  "sync_activity",
  "sync_cost",
]);

function assertUuid(value: string, field: string): void {
  if (!uuidShape.test(value)) {
    throw new Error(`Invalid connector ${field}`);
  }
}

function assertHttpStatus(value: number): void {
  if (!Number.isInteger(value) || value < 100 || value > 599) {
    throw new Error("Invalid connector HTTP status");
  }
}

function assertFailureClassification(
  value: Exclude<ConnectorCallClassification, "success">,
): void {
  if (
    value !== "rate_limited" &&
    value !== "provider_error" &&
    value !== "client_error"
  ) {
    throw new Error("Invalid connector failure classification");
  }
}

function assertSessionInput(input: Readonly<{
  vendorAccountId: string;
  provisioningActionId: string | null;
  operation: ConnectorOperation;
  correlationId: string;
}>): void {
  assertUuid(input.vendorAccountId, "vendor account ID");
  assertUuid(input.correlationId, "correlation ID");
  if (input.provisioningActionId !== null) {
    assertUuid(input.provisioningActionId, "provisioning action ID");
  }
  if (!connectorOperations.has(input.operation)) {
    throw new Error("Invalid connector operation");
  }
  if (syncOperations.has(input.operation) && input.provisioningActionId !== null) {
    throw new Error("Sync connector observations cannot link a provisioning action");
  }
}

export function buildConnectorCallSummary(input: SummaryInput): ConnectorCallSummary {
  if (input.phase === "requested") {
    return Object.freeze({
      endpoint_class: input.endpointClass,
      method: input.method,
    });
  }

  return Object.freeze({
    endpoint_class: input.endpointClass,
    method: input.method,
    http_status: input.httpStatus,
    status_class: input.classification,
  });
}

export function createConnectorCallObservationSession(input: Readonly<{
  vendorAccountId: string;
  provisioningActionId: string | null;
  operation: ConnectorOperation;
  clock: () => Date;
  randomId: () => string;
  append: ConnectorCallObservationAppender;
}>): ConnectorCallObservationSession {
  const correlationId = input.randomId();
  assertSessionInput({
    vendorAccountId: input.vendorAccountId,
    provisioningActionId: input.provisioningActionId,
    operation: input.operation,
    correlationId,
  });

  let nextAttempt = 1;
  const receipts = new Map<
    ConnectorAttemptReceipt,
    "pending" | "completing" | "completed"
  >();

  const append = async (
    attempt: number,
    phase: ConnectorCallPhase,
    classification: ConnectorCallClassification | null,
    summary: ConnectorCallSummary,
  ): Promise<void> => {
    await input.append({
      vendorAccountId: input.vendorAccountId,
      provisioningActionId: input.provisioningActionId,
      correlationId,
      operation: input.operation,
      attempt,
      phase,
      classification,
      summary,
      occurredAt: input.clock(),
    });
  };

  const requested = async (request: Readonly<{
    endpointClass: ConnectorEndpointClass;
    method: ConnectorMethod;
  }>): Promise<ConnectorAttemptReceipt> => {
    const attempt = nextAttempt++;
    await append(
      attempt,
      "requested",
      null,
      buildConnectorCallSummary({
        phase: "requested",
        endpointClass: request.endpointClass,
        method: request.method,
      }),
    );
    const receipt = Object.freeze({ attempt });
    receipts.set(receipt, "pending");
    return receipt;
  };

  const reserveTerminalReceipt = (receipt: ConnectorAttemptReceipt): void => {
    const state = receipts.get(receipt);
    if (state === undefined) {
      throw new Error("Connector attempt receipt does not belong to this session");
    }
    if (state !== "pending") {
      throw new Error("Connector attempt receipt has already been completed");
    }
    receipts.set(receipt, "completing");
  };

  const appendTerminal = async (
    receipt: ConnectorAttemptReceipt,
    phase: Exclude<ConnectorCallPhase, "requested">,
    classification: ConnectorCallClassification,
    summary: ConnectorCallSummary,
  ): Promise<void> => {
    reserveTerminalReceipt(receipt);
    try {
      await append(receipt.attempt, phase, classification, summary);
    } catch (error) {
      receipts.set(receipt, "pending");
      throw error;
    }
    receipts.set(receipt, "completed");
  };

  const succeeded = async (
    receipt: ConnectorAttemptReceipt,
    response: Readonly<{
      endpointClass: ConnectorEndpointClass;
      method: ConnectorMethod;
      httpStatus: number;
    }>,
  ): Promise<void> => {
    assertHttpStatus(response.httpStatus);
    await appendTerminal(
      receipt,
      "succeeded",
      "success",
      buildConnectorCallSummary({
        phase: "succeeded",
        endpointClass: response.endpointClass,
        method: response.method,
        httpStatus: response.httpStatus,
        classification: "success",
      }),
    );
  };

  const failed = async (
    receipt: ConnectorAttemptReceipt,
    response: Readonly<{
      endpointClass: ConnectorEndpointClass;
      method: ConnectorMethod;
      httpStatus: number;
      classification: Exclude<ConnectorCallClassification, "success">;
    }>,
  ): Promise<void> => {
    assertHttpStatus(response.httpStatus);
    assertFailureClassification(response.classification);
    await appendTerminal(
      receipt,
      "failed",
      response.classification,
      buildConnectorCallSummary({
        phase: "failed",
        endpointClass: response.endpointClass,
        method: response.method,
        httpStatus: response.httpStatus,
        classification: response.classification,
      }),
    );
  };

  return Object.freeze({ correlationId, requested, succeeded, failed });
}
