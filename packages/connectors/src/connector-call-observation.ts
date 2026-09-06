function freezeVocabulary<const Vocabulary extends readonly string[]>(
  ...values: Vocabulary
): Readonly<Vocabulary> {
  return Object.freeze(values);
}

export const connectorOperations = freezeVocabulary(
  "provision",
  "deprovision",
  "sync_members",
  "sync_activity",
  "sync_cost",
);
export const connectorCallPhases = freezeVocabulary(
  "requested",
  "succeeded",
  "failed",
);
export const connectorCallClassifications = freezeVocabulary(
  "success",
  "rate_limited",
  "provider_error",
  "client_error",
);
export const connectorEndpointClasses = freezeVocabulary(
  "organization",
  "members",
  "invitations",
  "activity",
  "usage",
  "cost",
);

export type ConnectorOperation = (typeof connectorOperations)[number];
export type ConnectorCallPhase = (typeof connectorCallPhases)[number];
export type ConnectorCallClassification =
  (typeof connectorCallClassifications)[number];
export type ConnectorEndpointClass = (typeof connectorEndpointClasses)[number];
export type ConnectorCallSummary = Readonly<{
  endpoint_class: ConnectorEndpointClass;
  method: "GET" | "POST" | "DELETE";
  http_status?: number;
  status_class?: ConnectorCallClassification;
}>;
export type ConnectorCallObservationAppendInput = Readonly<{
  vendorAccountId: string;
  provisioningActionId: string | null;
  correlationId: string;
  operation: ConnectorOperation;
  attempt: number;
  phase: ConnectorCallPhase;
  classification: ConnectorCallClassification | null;
  summary: ConnectorCallSummary;
  occurredAt: Date;
}>;
export type ConnectorCallObservationAppender =
  (input: ConnectorCallObservationAppendInput) => Promise<void>;
export type ConnectorAttemptReceipt = Readonly<{ attempt: number }>;
export type ConnectorCallObservationSession = Readonly<{
  correlationId: string;
  requested(input: Readonly<{
    endpointClass: ConnectorEndpointClass;
    method: "GET" | "POST" | "DELETE";
  }>): Promise<ConnectorAttemptReceipt>;
  succeeded(receipt: ConnectorAttemptReceipt, input: Readonly<{
    endpointClass: ConnectorEndpointClass;
    method: "GET" | "POST" | "DELETE";
    httpStatus: number;
  }>): Promise<void>;
  failed(receipt: ConnectorAttemptReceipt, input: Readonly<{
    endpointClass: ConnectorEndpointClass;
    method: "GET" | "POST" | "DELETE";
    httpStatus: number;
    classification: Exclude<ConnectorCallClassification, "success">;
  }>): Promise<void>;
}>;

type ConnectorMethod = "GET" | "POST" | "DELETE";

type SummaryInput = Readonly<{
  phase: ConnectorCallPhase;
  endpointClass: ConnectorEndpointClass;
  method: ConnectorMethod;
  httpStatus?: number;
  classification?: ConnectorCallClassification;
}>;

function assertUuid(value: string, field: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Invalid connector ${field}`);
  }
}

function assertHttpStatus(value: number): void {
  if (!Number.isInteger(value) || value < 100 || value > 599) {
    throw new Error("Invalid connector HTTP status");
  }
}

function assertFailureClassification(
  value: ConnectorCallClassification,
): void {
  if (!connectorCallClassifications.includes(value) || value === "success") {
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
  if (!connectorOperations.includes(input.operation)) {
    throw new Error("Invalid connector operation");
  }
  if (input.operation.startsWith("sync_") && input.provisioningActionId !== null) {
    throw new Error("Sync connector observations cannot link a provisioning action");
  }
}

export function buildConnectorCallSummary(input: SummaryInput): ConnectorCallSummary {
  if (!connectorCallPhases.includes(input.phase)) {
    throw new Error("Invalid connector phase");
  }
  if (!connectorEndpointClasses.includes(input.endpointClass)) {
    throw new Error("Invalid connector endpoint class");
  }
  if (
    input.phase !== "requested"
    && !connectorCallClassifications.some(
      (classification) => classification === input.classification,
    )
  ) {
    throw new Error("Invalid connector classification");
  }
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
  const receipts = new Map<ConnectorAttemptReceipt, boolean>();

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
    receipts.set(receipt, false);
    return receipt;
  };

  const reserveTerminalReceipt = (receipt: ConnectorAttemptReceipt): void => {
    const state = receipts.get(receipt);
    if (state === undefined) {
      throw new Error("Connector attempt receipt does not belong to this session");
    }
    if (state) {
      throw new Error("Connector attempt receipt has already been completed");
    }
    receipts.set(receipt, true);
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
      receipts.set(receipt, false);
      throw error;
    }
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
