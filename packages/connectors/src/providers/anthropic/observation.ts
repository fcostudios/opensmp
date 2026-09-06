import type {
  ConnectorAttemptReceipt,
  ConnectorCallObservationSession,
  ConnectorEndpointClass,
} from "../../contracts.js";

type AnthropicEndpoint =
  | "organization"
  | "members"
  | "invites"
  | "create_invite"
  | "delete_invite"
  | "analytics_users"
  | "analytics_summaries"
  | "usage_report"
  | "cost_report";
type AnthropicAttemptClassification =
  | "success"
  | "rate_limited"
  | "provider_error"
  | "client_error"
  | "transport_ambiguous";
type AnthropicAttemptObserverContract = (observation: Readonly<{
  endpoint: AnthropicEndpoint;
  method: "GET" | "POST" | "DELETE";
  attempt: number;
  phase: "requested" | "completed";
  observedAt: number;
  status: number | null;
  classification: AnthropicAttemptClassification | null;
}>) => Promise<void>;

function endpointClass(endpoint: AnthropicEndpoint): ConnectorEndpointClass {
  switch (endpoint) {
    case "organization":
      return "organization";
    case "members":
      return "members";
    case "invites":
    case "create_invite":
    case "delete_invite":
      return "invitations";
    case "analytics_users":
    case "analytics_summaries":
      return "activity";
    case "usage_report":
      return "usage";
    case "cost_report":
      return "cost";
  }
}

type KnownFailureClassification = Exclude<
  AnthropicAttemptClassification,
  "success" | "transport_ambiguous"
>;

function isKnownFailureClassification(
  classification: AnthropicAttemptClassification | null,
): classification is KnownFailureClassification {
  return classification === "rate_limited"
    || classification === "provider_error"
    || classification === "client_error";
}

export function createAnthropicConnectorObservationBridge(
  session: ConnectorCallObservationSession,
): AnthropicAttemptObserverContract {
  const requestedReceipts = new Map<number, ConnectorAttemptReceipt>();

  return async (observation) => {
    const neutralEndpointClass = endpointClass(observation.endpoint);

    if (observation.phase === "requested") {
      const receipt = await session.requested({
        endpointClass: neutralEndpointClass,
        method: observation.method,
      });
      requestedReceipts.set(observation.attempt, receipt);
      return;
    }

    const receipt = requestedReceipts.get(observation.attempt);
    if (receipt === undefined) {
      throw new Error(
        "Anthropic completed observation has no matching requested attempt",
      );
    }
    requestedReceipts.delete(observation.attempt);

    if (observation.status === null) {
      throw new Error("Anthropic completed observation requires a known response");
    }
    if (observation.classification === "success") {
      await session.succeeded(receipt, {
        endpointClass: neutralEndpointClass,
        method: observation.method,
        httpStatus: observation.status,
      });
      return;
    }
    if (!isKnownFailureClassification(observation.classification)) {
      throw new Error("Anthropic completed observation requires a known response");
    }
    await session.failed(receipt, {
      endpointClass: neutralEndpointClass,
      method: observation.method,
      httpStatus: observation.status,
      classification: observation.classification,
    });
  };
}
