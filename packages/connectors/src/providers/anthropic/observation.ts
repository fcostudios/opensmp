import type {
  ConnectorAttemptReceipt,
  ConnectorCallObservationSession,
  ConnectorEndpointClass,
} from "../../connector-call-observation.js";

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
type RequestedAttempt = {
  endpoint: AnthropicEndpoint;
  method: "GET" | "POST" | "DELETE";
  receipt: ConnectorAttemptReceipt | null;
};

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
  const requestedAttempts = new Map<number, RequestedAttempt>();

  return async (observation) => {
    const neutralEndpointClass = endpointClass(observation.endpoint);

    if (observation.phase === "requested") {
      if (requestedAttempts.has(observation.attempt)) {
        throw new Error(
          "Anthropic requested observation conflicts with an in-flight attempt",
        );
      }
      const requestedAttempt: RequestedAttempt = {
        endpoint: observation.endpoint,
        method: observation.method,
        receipt: null,
      };
      requestedAttempts.set(observation.attempt, requestedAttempt);
      try {
        requestedAttempt.receipt = await session.requested({
          endpointClass: neutralEndpointClass,
          method: observation.method,
        });
      } catch (error) {
        requestedAttempts.delete(observation.attempt);
        throw error;
      }
      return;
    }

    const requestedAttempt = requestedAttempts.get(observation.attempt);
    if (requestedAttempt === undefined || requestedAttempt.receipt === null) {
      throw new Error(
        "Anthropic completed observation has no matching requested attempt",
      );
    }
    if (
      requestedAttempt.endpoint !== observation.endpoint
      || requestedAttempt.method !== observation.method
    ) {
      throw new Error(
        "Anthropic completed observation does not match its requested endpoint and method",
      );
    }

    if (observation.status === null) {
      throw new Error("Anthropic completed observation requires a known response");
    }
    if (observation.classification === "success") {
      requestedAttempts.delete(observation.attempt);
      await session.succeeded(requestedAttempt.receipt, {
        endpointClass: neutralEndpointClass,
        method: observation.method,
        httpStatus: observation.status,
      });
      return;
    }
    if (!isKnownFailureClassification(observation.classification)) {
      throw new Error("Anthropic completed observation requires a known response");
    }
    requestedAttempts.delete(observation.attempt);
    await session.failed(requestedAttempt.receipt, {
      endpointClass: neutralEndpointClass,
      method: observation.method,
      httpStatus: observation.status,
      classification: observation.classification,
    });
  };
}
